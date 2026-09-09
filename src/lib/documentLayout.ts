import { jsPDF } from 'jspdf';
import type { ParsedTransaction } from '../types';
import type { ReceiptData } from './receiptGenerator';
import { computeReceiptData, fmt, fmtCurrency, getRecipientShort } from './receiptGenerator';
import {
    type DocRenderMeta, formatCovering, issuedDate, baseDisclaimerLines, trustDisclaimerLine,
    claimTotals, lineItemMismatch, sanitizeDocMeta,
} from './documentRender';
import { fmtTxDate } from './transactionDisplay';

// One layout for all four document types.
//
// Previously expense_summary had its own renderer and the other three shared a
// row-model builder, so the design had to be built and maintained twice. Both
// are retired here: buildDocModel produces a single structured model and the
// HTML and PDF renderers consume it, which is also what guarantees the numbers
// can never drift between the two.
//
// The look is a fintech statement rather than a thermal receipt: sans-serif,
// right-aligned tabular figures, and colour reserved entirely for the
// verified / self-reported status chips. Nothing else on the page is coloured,
// and there is deliberately no category-composition bar or chart.

// ── Palette. The only two coloured things on the document are the chips. ──
export const CHIP_VERIFIED_BG = '#E1F5EE';
export const CHIP_VERIFIED_TEXT = '#0F6E56';
export const CHIP_SELF_BG = '#FAEEDA';
export const CHIP_SELF_TEXT = '#854F0B';

const INK = '#111827';
const MUTED = '#6B7280';
const RULE = '#E5E7EB';
const PAPER = '#FFFFFF';

const DEMO_LINE = 'SAMPLE, NOT REAL DATA';

export type ChipKind = 'verified' | 'self-reported';

export interface DocLine {
    description: string;
    // date, and whatever else explains the line, as one muted second line
    sub: string;
    amount: string;
    chip: ChipKind;
    // point_of_sale itemisation, when a line carries it
    items: { text: string; amount: string }[];
}

export interface DocTotal {
    label: string;
    value: string;
    strong?: boolean;
}

export interface DocModel {
    typeLabel: string;
    reference: string;
    // point_of_sale puts the business name where M-Track's mark would be — the
    // document is meant to read as the merchant's, not the app's.
    brandName: string | null;
    heroLabel: string;
    heroAmount: string | null;
    contextLine: string;
    // One line stating the document's provenance, shown near the top, when
    // every entry shares the same source. null only when the document is
    // genuinely mixed — that's the one case where the per-row chip earns its
    // place, so showRowChips is true exactly then.
    sourceSummary: string | null;
    showRowChips: boolean;
    // Every included transaction, always. An exported document IS the record —
    // a "+42 more" row makes it unusable as the thing someone files or hands
    // over. The chat card's own entrance-animation grouping is a separate,
    // live-only concern and is untouched.
    lines: DocLine[];
    totals: DocTotal[];
    disclaimer: string;
    signature: boolean;
    isDemo: boolean;
}

const TYPE_LABEL: Record<DocRenderMeta['documentType'], string> = {
    expense_summary: 'EXPENSE SUMMARY',
    personal_note: 'PERSONAL RECORD',
    point_of_sale: 'RECEIPT',
    on_behalf_of: 'REIMBURSEMENT CLAIM',
};

// The hero label and the bold row in the totals block always agree.
const HERO_LABEL: Record<DocRenderMeta['documentType'], string> = {
    expense_summary: 'Total spent',
    personal_note: 'Total spent',
    point_of_sale: 'Total paid',
    on_behalf_of: 'Total due',
};

function chipFor(t: ParsedTransaction): ChipKind {
    return t.dataSource === 'self_reported' ? 'self-reported' : 'verified';
}

function buildLine(t: ParsedTransaction, meta: DocRenderMeta): DocLine {
    const bits: string[] = [fmtTxDate(t, { day: 'numeric', month: 'short', year: 'numeric' })];
    if (t.purposeLabel) bits.push(t.purposeLabel);
    else if (t.receiptLabel) bits.push(t.receiptLabel);
    else if (t.merchantCategory) bits.push(t.merchantCategory);
    if (t.transactionCode && !t.codeIsSynthetic) bits.push(`Ref ${t.transactionCode}`);
    if (t.transactionCost != null && t.transactionCost > 0) {
        bits.push(`Fee ${fmtCurrency(t.transactionCost, t.currency)}`);
    }

    const items: { text: string; amount: string }[] = [];
    if (meta.documentType === 'point_of_sale' && t.lineItems && t.lineItems.length > 0) {
        for (const li of t.lineItems) {
            const qty = li.quantity != null && li.unitPrice != null
                ? ` (${li.quantity} x ${fmtCurrency(li.unitPrice, t.currency)})` : '';
            items.push({ text: `${li.description}${qty}`, amount: fmtCurrency(li.amount, t.currency) });
        }
        const mm = lineItemMismatch(t);
        if (mm) {
            items.push({
                text: `Items add to ${fmtCurrency(mm.itemsTotal, t.currency)}, total given ${fmtCurrency(mm.lineTotal, t.currency)}`,
                amount: '',
            });
        }
    }

    return {
        description: getRecipientShort(t),
        sub: bits.join('  ·  '),
        amount: `${t.type === 'received' ? '+' : ''}${fmtCurrency(t.amount, t.currency)}`,
        chip: chipFor(t),
        items,
    };
}

// The provenance statement shown near the top of a single-source document,
// where fifty identical per-row chips would say nothing. null for a mixed
// document, which keeps the per-row chips instead.
function sourceSummaryFor(dataSource: DocRenderMeta['dataSource']): string | null {
    if (dataSource === 'self_reported') return 'All entries self-reported.';
    if (dataSource === 'sms_verified') return 'All entries verified from payment messages.';
    return null;
}

function buildContextLine(meta: DocRenderMeta, covering: string): string {
    const parts: string[] = [];
    if (meta.documentType === 'on_behalf_of') {
        parts.push(`Prepared for ${meta.onBehalfOf?.partyName ?? 'Unknown'}`);
        if (meta.onBehalfOf?.purpose) parts.push(meta.onBehalfOf.purpose);
    } else if (meta.documentType === 'point_of_sale') {
        if (meta.merchantProfile?.businessName) parts.push(meta.merchantProfile.businessName);
        if (meta.merchantProfile?.contact) parts.push(meta.merchantProfile.contact);
    }
    // Always the real derived span, never a relative label, and left out
    // entirely when there isn't one.
    if (covering) parts.push(covering);
    return parts.join('  ·  ');
}

function buildTotals(d: ReceiptData, meta: DocRenderMeta): { totals: DocTotal[]; hero: string | null; heroLabel: string } {
    const heroLabel = HERO_LABEL[meta.documentType];
    const boldLabel = heroLabel.toUpperCase();

    if (d.isMultiCurrency) {
        // Two currencies never become one figure.
        const totals: DocTotal[] = [];
        for (const pc of d.perCurrency) {
            totals.push({ label: `${pc.currency}, ${pc.count} item${pc.count === 1 ? '' : 's'}`, value: fmtCurrency(pc.amount, pc.currency) });
            if (pc.cost > 0) totals.push({ label: `${pc.currency} fees`, value: fmtCurrency(pc.cost, pc.currency) });
            totals.push({ label: `${boldLabel} (${pc.currency})`, value: fmtCurrency(pc.total, pc.currency), strong: true });
        }
        return { totals, hero: null, heroLabel: 'Totalled by currency' };
    }

    if (meta.documentType === 'on_behalf_of') {
        const ct = claimTotals(d);
        const totals: DocTotal[] = [
            { label: `Subtotal, ${ct.itemCount} item${ct.itemCount === 1 ? '' : 's'}`, value: fmt(ct.subtotal) },
        ];
        if (ct.transactionCosts > 0) totals.push({ label: 'Transaction fees', value: fmt(ct.transactionCosts) });
        totals.push({ label: boldLabel, value: fmt(ct.totalDue), strong: true });
        return { totals, hero: fmt(ct.totalDue), heroLabel };
    }

    const totals: DocTotal[] = [
        { label: `Subtotal, ${d.totalTransactionCount} item${d.totalTransactionCount === 1 ? '' : 's'}`, value: fmt(d.totalTransactionAmount) },
    ];
    if (d.totalTransactionCost > 0) totals.push({ label: 'Transaction fees', value: fmt(d.totalTransactionCost) });
    totals.push({ label: boldLabel, value: fmt(d.grandTotal), strong: true });
    return { totals, hero: fmt(d.grandTotal), heroLabel };
}

export function buildDocModel(transactions: ParsedTransaction[], rawMeta: DocRenderMeta, isDemo: boolean): DocModel {
    const meta = sanitizeDocMeta(rawMeta);
    const d = computeReceiptData(transactions);
    const covering = formatCovering(meta.coveringFrom, meta.coveringTo);
    const active = d.activeTransactions;

    const { totals, hero, heroLabel } = buildTotals(d, meta);

    const disclaimerParts = [...baseDisclaimerLines(meta.documentType)];
    const trust = trustDisclaimerLine(meta.dataSource, meta.documentType);
    if (trust) disclaimerParts.push(trust);

    return {
        typeLabel: TYPE_LABEL[meta.documentType],
        reference: d.receiptRef,
        brandName: meta.documentType === 'point_of_sale'
            ? (meta.merchantProfile?.businessName || 'Receipt')
            : null,
        heroLabel,
        heroAmount: hero,
        contextLine: buildContextLine(meta, covering),
        sourceSummary: sourceSummaryFor(meta.dataSource),
        showRowChips: meta.dataSource === 'mixed',
        lines: active.map(t => buildLine(t, meta)),
        totals,
        disclaimer: `${disclaimerParts.join(' ')} Issued ${issuedDate()}.`,
        signature: meta.documentType === 'on_behalf_of',
        isDemo,
    };
}

// ── HTML ─────────────────────────────────────────────────────────────────────

function esc(s: string): string {
    return s.replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

function chipHTML(kind: ChipKind): string {
    const bg = kind === 'verified' ? CHIP_VERIFIED_BG : CHIP_SELF_BG;
    const fg = kind === 'verified' ? CHIP_VERIFIED_TEXT : CHIP_SELF_TEXT;
    return `<span class="chip" style="background:${bg};color:${fg}">${kind}</span>`;
}

export function renderDocHTML(m: DocModel, qrDataUrl: string): string {
    const lines = m.lines.map(l => `
      <div class="row">
        <div class="rowMain">
          <div class="desc">${esc(l.description)}</div>
          <div class="sub">${esc(l.sub)}</div>
          ${l.items.map(i => `<div class="item"><span>${esc(i.text)}</span><span class="num">${esc(i.amount)}</span></div>`).join('')}
        </div>
        <div class="rowAmt">
          <div class="num amt">${esc(l.amount)}</div>
          ${m.showRowChips ? `<div>${chipHTML(l.chip)}</div>` : ''}
        </div>
      </div>`).join('');

    const totals = m.totals.map(t => `
      <div class="tot ${t.strong ? 'strong' : ''}">
        <span>${esc(t.label)}</span><span class="num">${esc(t.value)}</span>
      </div>`).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(m.brandName ?? 'M-Track')} ${esc(m.reference)}</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#F3F4F6;display:flex;justify-content:center;padding:32px 16px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:${INK};font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased}
  .doc{background:${PAPER};width:100%;max-width:420px;padding:28px 24px 20px;
    box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 32px rgba(0,0,0,.06);border-radius:6px}
  /* Everything that could be long wraps. Nothing on this document is allowed
     to run past its container. */
  .doc,.doc *{word-wrap:break-word;overflow-wrap:break-word;min-width:0}
  .head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
    font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}}
  .brand{font-size:15px;font-weight:700;letter-spacing:0;text-transform:none;color:${INK};margin-bottom:2px}
  .hero{margin:18px 0 6px}
  .heroLabel{font-size:11px;color:${MUTED}}
  .heroAmt{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.15;margin-top:2px}
  .ctx{font-size:11px;color:${MUTED};margin-bottom:5px}
  .src{font-size:11px;color:${MUTED};margin-bottom:5px}
  hr{border:0;border-top:1px solid ${RULE};margin:14px 0}
  .row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:9px 0;
    border-bottom:1px solid ${RULE}}
  .row:last-of-type{border-bottom:0}
  .rowMain{flex:1}
  .rowAmt{text-align:right;flex-shrink:0}
  .desc{font-weight:600;font-size:13px}
  .sub{font-size:10.5px;color:${MUTED};margin-top:2px}
  .item{display:flex;justify-content:space-between;gap:10px;font-size:10.5px;color:${MUTED};margin-top:2px;padding-left:10px}
  .note{font-size:10.5px;color:${MUTED};margin-top:3px;font-style:italic}
  .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
  .amt{font-weight:600;font-size:13px;white-space:nowrap}
  .chip{display:inline-block;margin-top:4px;padding:1px 7px;border-radius:999px;
    font-size:9px;font-weight:600;letter-spacing:.02em;white-space:nowrap}
  .tot{display:flex;justify-content:space-between;gap:14px;font-size:12px;color:${MUTED};padding:3px 0}
  .tot.strong{color:${INK};font-weight:700;font-size:14px;padding-top:9px;margin-top:5px;border-top:1px solid ${RULE};
    text-transform:uppercase;letter-spacing:.04em}
  .disc{font-size:10px;color:${MUTED};margin-top:16px;line-height:1.5}
  .demo{margin-top:12px;font-size:11px;font-weight:700;letter-spacing:.08em;color:${CHIP_SELF_TEXT};
    background:${CHIP_SELF_BG};padding:6px 10px;border-radius:4px;text-align:center}
  .sig{margin-top:26px;display:flex;gap:24px}
  .sigBox{flex:1}
  .sigRule{border-bottom:1px solid ${INK};height:26px}
  .sigLabel{font-size:10px;color:${MUTED};margin-top:5px}
  .foot{margin-top:22px;padding-top:14px;border-top:1px solid ${RULE};
    display:flex;align-items:center;gap:12px}
  .footText{font-size:10px;color:${MUTED};line-height:1.45}
  @media print{body{background:#fff;padding:0}.doc{box-shadow:none;max-width:none;border-radius:0}}
</style>
</head>
<body>
  <div class="doc">
    ${m.brandName ? `<div class="brand">${esc(m.brandName)}</div>` : ''}
    <div class="head"><span>${esc(m.typeLabel)}</span><span>${esc(m.reference)}</span></div>

    <div class="hero">
      <div class="heroLabel">${esc(m.heroLabel)}</div>
      ${m.heroAmount ? `<div class="heroAmt num">${esc(m.heroAmount)}</div>` : ''}
    </div>
    ${m.contextLine ? `<div class="ctx">${esc(m.contextLine)}</div>` : ''}
    ${m.sourceSummary ? `<div class="src">${esc(m.sourceSummary)}</div>` : ''}

    <hr>
    ${lines}
    <hr>

    <div>${totals}</div>

    <div class="disc">${esc(m.disclaimer)}</div>
    ${m.isDemo ? `<div class="demo">${DEMO_LINE}</div>` : ''}

    ${m.signature ? `
    <div class="sig">
      <div class="sigBox"><div class="sigRule"></div><div class="sigLabel">Approved by</div></div>
      <div class="sigBox"><div class="sigRule"></div><div class="sigLabel">Date</div></div>
    </div>` : ''}

    <div class="foot">
      <img src="${qrDataUrl}" width="48" height="48" alt="QR code linking to mtrack.vercel.app" />
      <div class="footText">Made with M-Track<br>mtrack.vercel.app</div>
    </div>
  </div>
</body>
</html>`;
}

// ── PDF ──────────────────────────────────────────────────────────────────────

const PAGE_W = 100;      // mm — compact and mobile-appropriate, with room for
const MARGIN = 7;        // a right-aligned amount column
const CONTENT_W = PAGE_W - MARGIN * 2;
const AMOUNT_COL_W = 30; // reserved on the right, so a long name can never
const DESC_W = CONTENT_W - AMOUNT_COL_W - 3;

function hex(h: string): [number, number, number] {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const PT_TO_MM = 0.352777;

// Line height in mm for a given point size, with a little leading.
function lh(size: number): number {
    return size * 0.42;
}

// Roughly how far a line of type at `sizePt` reaches above and below its
// baseline, in mm. Used to stack differently-sized elements — a small label
// then a big number — without their glyph boxes colliding. jsPDF's own
// text() advances nothing, and lh() only accounts for a same-size run.
function ascentMm(sizePt: number): number { return sizePt * PT_TO_MM * 0.78; }
function descentMm(sizePt: number): number { return sizePt * PT_TO_MM * 0.24; }

// Every string drawn to the page goes through here. jsPDF does not wrap — it
// draws straight past the page edge — so a long disclaimer or purpose used to
// overflow both margins. splitTextToSize is not optional.
function drawWrapped(
    doc: jsPDF, text: string, x: number, y: number, width: number,
    size: number, bold: boolean, color: string, align: 'left' | 'right' = 'left',
): number {
    if (!text) return y;
    doc.setFontSize(size);
    doc.setFont('helvetica', bold ? 'bold' : 'normal');
    doc.setTextColor(...hex(color));
    const parts = doc.splitTextToSize(text, width) as string[];
    for (const part of parts) {
        doc.text(part, align === 'right' ? x + width : x, y, { align });
        y += lh(size);
    }
    return y;
}

function drawRule(doc: jsPDF, y: number): number {
    doc.setDrawColor(...hex(RULE));
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    return y + 2.4;
}

function drawChip(doc: jsPDF, kind: ChipKind, rightEdge: number, y: number): number {
    const bg = kind === 'verified' ? CHIP_VERIFIED_BG : CHIP_SELF_BG;
    const fg = kind === 'verified' ? CHIP_VERIFIED_TEXT : CHIP_SELF_TEXT;
    const size = 5.5;
    doc.setFontSize(size);
    doc.setFont('helvetica', 'bold');
    const textW = doc.getTextWidth(kind);
    const padX = 1.4, boxH = 2.9;
    const boxW = textW + padX * 2;
    doc.setFillColor(...hex(bg));
    doc.roundedRect(rightEdge - boxW, y - boxH + 0.7, boxW, boxH, 1.2, 1.2, 'F');
    doc.setTextColor(...hex(fg));
    doc.text(kind, rightEdge - padX, y - 0.6, { align: 'right' });
    return y + lh(size);
}

// The layout is run twice: once against a throwaway document purely to measure
// the height it needs, then again for real at that exact height. Same code both
// times, so the measured height can never disagree with what gets drawn.
function layout(doc: jsPDF, m: DocModel, qrDataUrl: string | null): number {
    let y = 11;

    if (m.brandName) {
        y = drawWrapped(doc, m.brandName, MARGIN, y, CONTENT_W, 13, true, INK);
        y += 0.5;
    }

    // Header row: type label left, reference right.
    const HEADER_PT = 6.5;
    doc.setFontSize(HEADER_PT);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(...hex(MUTED));
    doc.text(m.typeLabel, MARGIN, y);
    doc.text(m.reference, PAGE_W - MARGIN, y, { align: 'right' });
    y += descentMm(HEADER_PT);

    // ── Hero block. Stacked explicitly with ascent/descent spacing so the
    // small label and the large amount never share vertical space — that
    // collision showed as ghosted text behind the big number. ──
    const HERO_LABEL_PT = 8;
    const HERO_AMOUNT_PT = 22;

    y += 5;                                     // gap under the header row
    doc.setFontSize(HERO_LABEL_PT);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...hex(MUTED));
    doc.text(m.heroLabel, MARGIN, y);           // label baseline

    if (m.heroAmount) {
        // Drop far enough that the amount's ascenders clear the label's descenders.
        y += descentMm(HERO_LABEL_PT) + ascentMm(HERO_AMOUNT_PT) + 1.6;
        doc.setFontSize(HERO_AMOUNT_PT);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...hex(INK));
        doc.text(m.heroAmount, MARGIN, y);      // amount baseline
        y += descentMm(HERO_AMOUNT_PT) + 3;     // clear its descenders, then a gap
    } else {
        y += descentMm(HERO_LABEL_PT) + 3;
    }

    if (m.contextLine) y = drawWrapped(doc, m.contextLine, MARGIN, y, CONTENT_W, 7, false, MUTED);
    if (m.sourceSummary) y = drawWrapped(doc, m.sourceSummary, MARGIN, y + 0.6, CONTENT_W, 7, false, MUTED);

    y += 2;
    y = drawRule(doc, y);

    for (const l of m.lines) {
        const top = y;
        // Description column, wrapped inside its own width so it can never
        // reach the amount column.
        let leftY = drawWrapped(doc, l.description, MARGIN, y, DESC_W, 8.5, true, INK);
        if (l.sub) leftY = drawWrapped(doc, l.sub, MARGIN, leftY + 0.4, DESC_W, 6.5, false, MUTED);
        for (const it of l.items) {
            leftY = drawWrapped(doc, `${it.text}${it.amount ? '   ' + it.amount : ''}`, MARGIN + 2, leftY + 0.3, DESC_W - 2, 6.5, false, MUTED);
        }

        // Amount column, right-aligned. The status chip goes under it only on a
        // mixed-source document — otherwise the one-line summary up top says it.
        let rightY = drawWrapped(doc, l.amount, PAGE_W - MARGIN - AMOUNT_COL_W, top, AMOUNT_COL_W, 8.5, true, INK, 'right');
        if (m.showRowChips) rightY = drawChip(doc, l.chip, PAGE_W - MARGIN, rightY + 1.2);

        y = Math.max(leftY, rightY) + 2;
        y = drawRule(doc, y - 1.2);
    }

    y += 2;
    for (const t of m.totals) {
        const size = t.strong ? 10 : 7.5;
        if (t.strong) y += 1.5;
        doc.setFontSize(size);
        doc.setFont('helvetica', t.strong ? 'bold' : 'normal');
        doc.setTextColor(...hex(t.strong ? INK : MUTED));
        // The label is wrapped against the space left over by the value.
        const valueW = doc.getTextWidth(t.value);
        const labelParts = doc.splitTextToSize(t.label, CONTENT_W - valueW - 4) as string[];
        doc.text(labelParts[0], MARGIN, y);
        doc.text(t.value, PAGE_W - MARGIN, y, { align: 'right' });
        y += lh(size);
        for (const extra of labelParts.slice(1)) {
            doc.text(extra, MARGIN, y);
            y += lh(size);
        }
    }

    y += 4;
    y = drawWrapped(doc, m.disclaimer, MARGIN, y, CONTENT_W, 6, false, MUTED);

    if (m.isDemo) {
        y += 2.5;
        doc.setFillColor(...hex(CHIP_SELF_BG));
        doc.roundedRect(MARGIN, y - 3.2, CONTENT_W, 5, 1, 1, 'F');
        doc.setFontSize(7);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...hex(CHIP_SELF_TEXT));
        doc.text(DEMO_LINE, PAGE_W / 2, y, { align: 'center' });
        y += lh(7) + 2;
    }

    if (m.signature) {
        y += 10;
        const boxW = (CONTENT_W - 8) / 2;
        doc.setDrawColor(...hex(INK));
        doc.setLineWidth(0.25);
        doc.line(MARGIN, y, MARGIN + boxW, y);
        doc.line(MARGIN + boxW + 8, y, PAGE_W - MARGIN, y);
        y += 3.2;
        doc.setFontSize(6.5);
        doc.setFont('helvetica', 'normal');
        doc.setTextColor(...hex(MUTED));
        doc.text('Approved by', MARGIN, y);
        doc.text('Date', MARGIN + boxW + 8, y);
        y += lh(6.5);
    }

    y += 5;
    y = drawRule(doc, y);
    const qrSize = 14;
    if (qrDataUrl) doc.addImage(qrDataUrl, 'PNG', MARGIN, y, qrSize, qrSize);
    doc.setFontSize(6.5);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...hex(MUTED));
    doc.text('Made with M-Track', MARGIN + qrSize + 4, y + 5.5);
    doc.text('mtrack.vercel.app', MARGIN + qrSize + 4, y + 5.5 + lh(6.5));
    y += qrSize + 5;

    return y;
}

export interface DrawnString {
    text: string;
    left: number;
    right: number;
    // Baseline y in mm, and the approximate top/bottom of the glyph box, so a
    // test can check both horizontal margins and vertical clipping.
    y: number;
    top: number;
    bottom: number;
}

// Every string the PDF layout actually draws, with its measured horizontal
// extent in mm. Exists so the overflow bug that put a disclaimer past both page
// margins in production can be regression-tested directly: jsPDF does not wrap,
// so "it looked fine" is not a check. jsPDF assigns `text` as an own property
// per instance, which is why this has to live next to the layout rather than
// being patched in from a test.
export function measureDrawnStrings(m: DocModel): DrawnString[] {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, 4000] });
    doc.setFont('helvetica', 'normal');
    const drawn: DrawnString[] = [];
    const original = doc.text.bind(doc);
    const PT_TO_MM = 0.352777;
    (doc as unknown as { text: unknown }).text = function (
        text: string | string[], x: number, y: number, opts?: { align?: string },
    ) {
        const sizeMm = doc.getFontSize() * PT_TO_MM;
        for (const part of Array.isArray(text) ? text : [String(text)]) {
            const w = doc.getTextWidth(part);
            const align = opts?.align ?? 'left';
            const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
            drawn.push({
                text: part, left, right: left + w, y,
                top: y - sizeMm * 0.75, bottom: y + sizeMm * 0.25,
            });
        }
        return original(text, x, y, opts as Parameters<typeof original>[3]);
    };
    layout(doc, m, null);
    return drawn;
}

export const PDF_PAGE_WIDTH_MM = PAGE_W;
export const PDF_MARGIN_MM = MARGIN;

export function renderDocPDF(m: DocModel, qrDataUrl: string): Blob {
    // Pass 1 — measure. Tall scratch page so nothing is clipped while sizing.
    const scratch = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, 4000] });
    scratch.setFont('helvetica', 'normal');
    const needed = layout(scratch, m, null);

    // jsPDF's hard ceiling is 14400 user units; stay well inside it.
    const height = Math.max(120, Math.min(needed + 4, 5000));
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, height] });
    doc.setFont('helvetica', 'normal');
    layout(doc, m, qrDataUrl);
    return doc.output('blob');
}
