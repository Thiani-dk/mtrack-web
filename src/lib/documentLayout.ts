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

export function renderDocHTML(m: DocModel, qrDataUrl: string, geistWoff2B64?: string): string {
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
  ${geistWoff2B64
    ? `@font-face{font-family:'Geist';src:url(data:font/woff2;base64,${geistWoff2B64}) format('woff2');font-weight:100 900;font-style:normal;font-display:swap}`
    : ''}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#F3F4F6;display:flex;justify-content:center;padding:32px 16px;
    font-family:${geistWoff2B64 ? "'Geist'," : ''}-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
    color:${INK};font-size:13px;line-height:1.5;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
  .doc{background:${PAPER};width:100%;max-width:420px;padding:26px 22px 18px;
    border:1px solid ${RULE};border-radius:12px;
    box-shadow:0 1px 3px rgba(0,0,0,.08),0 8px 32px rgba(0,0,0,.06)}
  /* Everything that could be long wraps. Nothing on this document is allowed
     to run past its container. */
  .doc,.doc *{word-wrap:break-word;overflow-wrap:break-word;min-width:0}
  .head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;
    font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:${MUTED}}
  .brand{font-size:15px;font-weight:700;letter-spacing:0;text-transform:none;color:${INK};margin-bottom:2px}
  .hero{margin:18px 0 6px}
  .heroLabel{font-size:11px;color:${MUTED};font-weight:400}
  .heroAmt{font-size:30px;font-weight:700;letter-spacing:-.02em;line-height:1.15;margin-top:3px;color:${INK}}
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
  @media print{body{background:#fff;padding:0}.doc{box-shadow:none;max-width:none}}
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

// The document sits inside a rounded, bordered card inset from the page edge
// with real padding to the content — matching the interactive chat card's
// framing (rounded-xl ~= 12px, 1px hairline border) rather than starting flush
// at the margin, which is a big part of why the card reads as a designed
// document and the old PDF read as a text dump.
const PAGE_W = 100;              // mm
const FRAME_INSET = 3.4;         // page edge -> card border
const FRAME_RADIUS = 3.2;        // the card's 12px, at a ~378px-equivalent width
const FRAME_PAD = 4;             // card border -> content
const MARGIN = FRAME_INSET + FRAME_PAD;   // content left / right edge
const CONTENT_W = PAGE_W - MARGIN * 2;
const AMOUNT_COL_W = 26;         // reserved on the right, so a long name never
const DESC_W = CONTENT_W - AMOUNT_COL_W - 3;   // reaches the amount column
const MAX_PAGE_MM = 5000;        // jsPDF's hard ceiling is ~14400 units; stay inside

function hex(h: string): [number, number, number] {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const PT_TO_MM = 0.352777;

// Line height in mm for a run of type at `sizePt`.
function lh(sizePt: number): number { return sizePt * 0.42; }

// Roughly how far a line of type at `sizePt` reaches above / below its baseline,
// in mm — for stacking two differently-sized elements (a small label, then a
// big number) without their glyph boxes colliding. jsPDF's text() advances
// nothing on its own, and lh() only covers a same-size run.
function ascentMm(sizePt: number): number { return sizePt * PT_TO_MM * 0.78; }
function descentMm(sizePt: number): number { return sizePt * PT_TO_MM * 0.24; }

// The type scale, matched to ChatReceiptVisual's tiers. Two embedded weights
// (Geist 400 / 700); the finer gradations the card gets from 500/600 are
// carried here by size and the INK / MUTED split, same as the card.
const TYPE = {
    brand:      { pt: 15,   bold: true,  color: INK },
    header:     { pt: 7,    bold: true,  color: MUTED },
    heroLabel:  { pt: 9,    bold: false, color: MUTED },
    heroAmount: { pt: 24,   bold: true,  color: INK },
    context:    { pt: 8,    bold: false, color: MUTED },
    rowTitle:   { pt: 9.5,  bold: true,  color: INK },
    rowSub:     { pt: 7,    bold: false, color: MUTED },
    amount:     { pt: 9.5,  bold: true,  color: INK },
    totLabel:   { pt: 8,    bold: false, color: MUTED },
    totStrong:  { pt: 11.5, bold: true,  color: INK },
    disclaimer: { pt: 6.5,  bold: false, color: MUTED },
    footer:     { pt: 6.5,  bold: false, color: MUTED },
} as const;
type Tier = keyof typeof TYPE;

export interface PdfFontData {
    // base64 TrueType (glyf) instances — jsPDF 4.x parses glyf only.
    regular: string;
    bold: string;
}

// Registers Geist on a jsPDF instance and returns the family to use: 'Geist' on
// success, 'helvetica' if the embed fails for any reason. The fallback is
// logged, never silent — this function exists so a generic-font regression is
// observable rather than shipped quietly.
function registerFont(doc: jsPDF, fonts: PdfFontData): string {
    try {
        doc.addFileToVFS('Geist-Regular.ttf', fonts.regular);
        doc.addFont('Geist-Regular.ttf', 'Geist', 'normal');
        doc.addFileToVFS('Geist-Bold.ttf', fonts.bold);
        doc.addFont('Geist-Bold.ttf', 'Geist', 'bold');
        doc.setFont('Geist', 'normal');
        doc.getTextWidth('0');   // forces the font to parse; throws here if unusable
        return 'Geist';
    } catch (err) {
        if (typeof console !== 'undefined') {
            console.warn('PDF export: Geist embed failed, falling back to Helvetica.', err);
        }
        return 'helvetica';
    }
}

function applyTier(doc: jsPDF, family: string, tier: Tier): number {
    const t = TYPE[tier];
    doc.setFontSize(t.pt);
    doc.setFont(family, t.bold ? 'bold' : 'normal');
    doc.setTextColor(...hex(t.color));
    return t.pt;
}

// Every string the layout draws goes through here. jsPDF does not wrap — it
// runs straight past the page edge — so splitTextToSize against the column
// width is not optional.
function drawWrapped(
    doc: jsPDF, family: string, tier: Tier, text: string,
    x: number, y: number, width: number, align: 'left' | 'right' = 'left',
): number {
    if (!text) return y;
    const pt = applyTier(doc, family, tier);
    for (const part of doc.splitTextToSize(text, width) as string[]) {
        doc.text(part, align === 'right' ? x + width : x, y, { align });
        y += lh(pt);
    }
    return y;
}

function drawRule(doc: jsPDF, y: number): number {
    doc.setDrawColor(...hex(RULE));
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y, PAGE_W - MARGIN, y);
    return y + 2.4;
}

function drawChip(doc: jsPDF, family: string, kind: ChipKind, rightEdge: number, y: number): number {
    const bg = kind === 'verified' ? CHIP_VERIFIED_BG : CHIP_SELF_BG;
    const fg = kind === 'verified' ? CHIP_VERIFIED_TEXT : CHIP_SELF_TEXT;
    const size = 5.5;
    doc.setFontSize(size);
    doc.setFont(family, 'bold');
    const padX = 1.4, boxH = 2.9;
    const boxW = doc.getTextWidth(kind) + padX * 2;
    doc.setFillColor(...hex(bg));
    doc.roundedRect(rightEdge - boxW, y - boxH + 0.7, boxW, boxH, 1.2, 1.2, 'F');
    doc.setTextColor(...hex(fg));
    doc.text(kind, rightEdge - padX, y - 0.6, { align: 'right' });
    return y + lh(size);
}

// Run twice: once against a throwaway document to measure the height needed,
// then for real at that exact height. Identical both times, so the measured
// height can never disagree with what gets drawn.
function layout(doc: jsPDF, m: DocModel, qrDataUrl: string | null, family: string): number {
    let y = MARGIN + 3.5;

    if (m.brandName) {
        y = drawWrapped(doc, family, 'brand', m.brandName, MARGIN, y, CONTENT_W);
        y += 0.5;
    }

    // Header row: type label left, reference right.
    const headerPt = applyTier(doc, family, 'header');
    doc.text(m.typeLabel, MARGIN, y);
    doc.text(m.reference, PAGE_W - MARGIN, y, { align: 'right' });
    y += descentMm(headerPt);

    // ── Hero block. Stacked explicitly with ascent/descent spacing so the
    // small label and the large amount never share vertical space. ──
    const heroLabelPt = TYPE.heroLabel.pt;
    const heroAmountPt = TYPE.heroAmount.pt;

    y += 5.5;                                    // gap under the header row
    applyTier(doc, family, 'heroLabel');
    doc.text(m.heroLabel, MARGIN, y);            // label baseline

    if (m.heroAmount) {
        y += descentMm(heroLabelPt) + ascentMm(heroAmountPt) + 1.8;
        applyTier(doc, family, 'heroAmount');
        doc.text(m.heroAmount, MARGIN, y);       // amount baseline
        y += descentMm(heroAmountPt) + 3.2;
    } else {
        y += descentMm(heroLabelPt) + 3.2;
    }

    if (m.contextLine) y = drawWrapped(doc, family, 'context', m.contextLine, MARGIN, y, CONTENT_W);
    if (m.sourceSummary) y = drawWrapped(doc, family, 'context', m.sourceSummary, MARGIN, y + 0.6, CONTENT_W);

    y += 2.5;
    y = drawRule(doc, y);

    for (const l of m.lines) {
        const top = y;
        let leftY = drawWrapped(doc, family, 'rowTitle', l.description, MARGIN, y, DESC_W);
        if (l.sub) leftY = drawWrapped(doc, family, 'rowSub', l.sub, MARGIN, leftY + 0.6, DESC_W);
        for (const it of l.items) {
            leftY = drawWrapped(doc, family, 'rowSub', `${it.text}${it.amount ? '   ' + it.amount : ''}`, MARGIN + 2, leftY + 0.3, DESC_W - 2);
        }

        let rightY = drawWrapped(doc, family, 'amount', l.amount, PAGE_W - MARGIN - AMOUNT_COL_W, top, AMOUNT_COL_W, 'right');
        // The status chip only on a mixed-source document; otherwise the
        // one-line summary near the top has already said it.
        if (m.showRowChips) rightY = drawChip(doc, family, l.chip, PAGE_W - MARGIN, rightY + 1.4);

        y = Math.max(leftY, rightY) + 2.4;
        y = drawRule(doc, y - 1.4);
    }

    y += 2.5;
    for (const t of m.totals) {
        const tier: Tier = t.strong ? 'totStrong' : 'totLabel';
        if (t.strong) y += 2;
        const pt = applyTier(doc, family, tier);
        const valueW = doc.getTextWidth(t.value);
        const labelParts = doc.splitTextToSize(t.label, CONTENT_W - valueW - 4) as string[];
        doc.text(labelParts[0], MARGIN, y);
        doc.text(t.value, PAGE_W - MARGIN, y, { align: 'right' });
        y += lh(pt);
        for (const extra of labelParts.slice(1)) { doc.text(extra, MARGIN, y); y += lh(pt); }
    }

    y += 4.5;
    y = drawWrapped(doc, family, 'disclaimer', m.disclaimer, MARGIN, y, CONTENT_W);

    if (m.isDemo) {
        y += 3;
        doc.setFillColor(...hex(CHIP_SELF_BG));
        doc.roundedRect(MARGIN, y - 3.3, CONTENT_W, 5.2, 1, 1, 'F');
        doc.setFontSize(7);
        doc.setFont(family, 'bold');
        doc.setTextColor(...hex(CHIP_SELF_TEXT));
        doc.text(DEMO_LINE, PAGE_W / 2, y, { align: 'center' });
        y += lh(7) + 2;
    }

    if (m.signature) {
        y += 11;
        const boxW = (CONTENT_W - 8) / 2;
        doc.setDrawColor(...hex(INK));
        doc.setLineWidth(0.25);
        doc.line(MARGIN, y, MARGIN + boxW, y);
        doc.line(MARGIN + boxW + 8, y, PAGE_W - MARGIN, y);
        y += 3.4;
        applyTier(doc, family, 'footer');
        doc.text('Approved by', MARGIN, y);
        doc.text('Date', MARGIN + boxW + 8, y);
        y += lh(TYPE.footer.pt);
    }

    y += 5;
    y = drawRule(doc, y);
    const qrSize = 14;
    if (qrDataUrl) doc.addImage(qrDataUrl, 'PNG', MARGIN, y, qrSize, qrSize);
    applyTier(doc, family, 'footer');
    doc.text('Made with M-Track', MARGIN + qrSize + 4, y + 5.6);
    doc.text('mtrack.vercel.app', MARGIN + qrSize + 4, y + 5.6 + lh(TYPE.footer.pt));
    y += qrSize + 1.5;

    return y;
}

function drawFrame(doc: jsPDF, pageH: number): void {
    doc.setDrawColor(...hex(RULE));
    doc.setLineWidth(0.25);
    doc.roundedRect(
        FRAME_INSET, FRAME_INSET,
        PAGE_W - FRAME_INSET * 2, pageH - FRAME_INSET * 2,
        FRAME_RADIUS, FRAME_RADIUS, 'S',
    );
}

export interface DrawnString {
    text: string;
    left: number;
    right: number;
    // Baseline y in mm, plus the approximate top / bottom of the glyph box, so
    // a test can check both margin overflow and vertical clipping / overlap.
    y: number;
    top: number;
    bottom: number;
    // The state at draw time, so a test can check the type hierarchy is real
    // (hero heavier/larger than a row title heavier/larger than a muted sub)
    // rather than flat.
    sizePt: number;
    bold: boolean;
    color: string;
    fontName: string;
}

// Every string the PDF layout actually draws, with its measured box in mm.
// Exists so the overflow bug that once put a disclaimer past both margins can
// be regression-tested directly — jsPDF does not wrap, so "it looked fine" is
// not a check. jsPDF assigns text() as an own property per instance, which is
// why this lives next to the layout. Pass `fonts` to measure with the real
// embedded typeface rather than Helvetica.
export function measureDrawnStrings(m: DocModel, fonts?: PdfFontData): DrawnString[] {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, 4000] });
    const family = fonts ? registerFont(doc, fonts) : 'helvetica';
    doc.setFont(family, 'normal');
    const drawn: DrawnString[] = [];
    const original = doc.text.bind(doc);
    (doc as unknown as { text: unknown }).text = function (
        text: string | string[], x: number, y: number, opts?: { align?: string },
    ) {
        const sizePt = doc.getFontSize();
        const sizeMm = sizePt * PT_TO_MM;
        const f = doc.getFont();
        const style = String(f?.fontStyle ?? '').toLowerCase();
        const color = (() => { try { return String(doc.getTextColor()); } catch { return ''; } })();
        for (const part of Array.isArray(text) ? text : [String(text)]) {
            const w = doc.getTextWidth(part);
            const align = opts?.align ?? 'left';
            const left = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
            drawn.push({
                text: part, left, right: left + w, y,
                top: y - sizeMm * 0.75, bottom: y + sizeMm * 0.25,
                sizePt, bold: style.includes('bold'), color,
                fontName: String(f?.fontName ?? ''),
            });
        }
        return original(text, x, y, opts as Parameters<typeof original>[3]);
    };
    layout(doc, m, null, family);
    return drawn;
}

export const PDF_PAGE_WIDTH_MM = PAGE_W;
export const PDF_MARGIN_MM = MARGIN;
export const PDF_FRAME_INSET_MM = FRAME_INSET;

export function renderDocPDF(m: DocModel, qrDataUrl: string, fonts?: PdfFontData): Blob {
    // Pass 1 — measure on a tall scratch page so nothing clips while sizing.
    const scratch = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, 4000] });
    const family = fonts ? registerFont(scratch, fonts) : 'helvetica';
    scratch.setFont(family, 'normal');
    const contentBottom = layout(scratch, m, null, family);

    const pageH = Math.max(120, Math.min(contentBottom + FRAME_PAD + FRAME_INSET, MAX_PAGE_MM));
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, pageH] });
    const family2 = fonts ? registerFont(doc, fonts) : 'helvetica';
    doc.setFont(family2, 'normal');
    drawFrame(doc, pageH);
    layout(doc, m, qrDataUrl, family2);
    return doc.output('blob');
}
