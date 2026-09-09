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
// right-aligned tabular figures, and no colour used as an organising device —
// data source is stated in plain text, not a coloured chip. There is
// deliberately no category-composition bar or chart.

const INK = '#111827';
const MUTED = '#6B7280';
const RULE = '#E5E7EB';
const PAPER = '#FFFFFF';

const DEMO_LINE = 'SAMPLE, NOT REAL DATA';

export interface DocLine {
    date: string;
    description: string;
    // The purpose / reason. Rendered after an em-dash on the description's line
    // when it fits; wrapped onto its own line beneath when it doesn't — never
    // truncated. The amount stays put either way.
    reason: string | null;
    // Ref and fee — the quiet trailing metadata line.
    detail: string;
    amount: string;
    // point_of_sale itemisation, when a line carries it
    items: { text: string; amount: string }[];
    // On a mixed-source document, a small plain-text tag on the minority-source
    // rows only — "entered by hand" or "from payment messages". null otherwise.
    sourceTag: string | null;
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
    // One plain-text line stating where every figure came from, always shown
    // near the top: "Source: all entries from payment messages." /
    // "Source: all entries entered by hand." / "Source: 18 from payment
    // messages, 4 entered by hand." No colour, no badge — the per-row tags
    // (DocLine.sourceTag) carry the mixed case row by row.
    sourceStatement: string;
    // Every included transaction, always. An exported document IS the record —
    // a "+42 more" row makes it unusable as the thing someone files or hands
    // over. The chat card's own entrance-animation grouping is a separate,
    // live-only concern and is untouched.
    lines: DocLine[];
    totals: DocTotal[];
    disclaimer: string;
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

// Display words for a transaction's source. The underlying enum values
// ('sms_verified' / 'self_reported') are unchanged — only the human text.
const SOURCE_FROM_MESSAGES = 'from payment messages';
const SOURCE_BY_HAND = 'entered by hand';

function buildLine(t: ParsedTransaction, meta: DocRenderMeta, minoritySource: ParsedTransaction['dataSource'] | null): DocLine {
    const reason = t.purposeLabel || t.receiptLabel || t.merchantCategory || null;

    const detailBits: string[] = [];
    if (t.transactionCode && !t.codeIsSynthetic) detailBits.push(`Ref ${t.transactionCode}`);
    if (t.transactionCost != null && t.transactionCost > 0) {
        detailBits.push(`Fee ${fmtCurrency(t.transactionCost, t.currency)}`);
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

    const sourceTag = minoritySource != null && t.dataSource === minoritySource
        ? (minoritySource === 'self_reported' ? SOURCE_BY_HAND : SOURCE_FROM_MESSAGES)
        : null;

    return {
        date: fmtTxDate(t, { day: 'numeric', month: 'short', year: 'numeric' }),
        description: getRecipientShort(t),
        reason,
        detail: detailBits.join('  ·  '),
        amount: `${t.type === 'received' ? '+' : ''}${fmtCurrency(t.amount, t.currency)}`,
        items,
        sourceTag,
    };
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

// The source statement, and (for a mixed document) which source is the
// minority — those rows, and only those, get a small plain-text tag. Exported
// so the interactive chat card derives exactly the same words as the exports.
export const SOURCE_TAG_BY_HAND = SOURCE_BY_HAND;
export const SOURCE_TAG_FROM_MESSAGES = SOURCE_FROM_MESSAGES;

export function sourceReport(active: ParsedTransaction[]): {
    statement: string;
    minoritySource: ParsedTransaction['dataSource'] | null;
} {
    const byHand = active.filter(t => t.dataSource === 'self_reported').length;
    const fromMsg = active.length - byHand;
    if (byHand === 0) return { statement: 'Source: all entries from payment messages.', minoritySource: null };
    if (fromMsg === 0) return { statement: 'Source: all entries entered by hand.', minoritySource: null };
    return {
        statement: `Source: ${fromMsg} ${SOURCE_FROM_MESSAGES}, ${byHand} ${SOURCE_BY_HAND}.`,
        // Tie goes to tagging the hand-entered rows — that's the flag a reader wants.
        minoritySource: byHand <= fromMsg ? 'self_reported' : 'sms_verified',
    };
}

export function buildDocModel(transactions: ParsedTransaction[], rawMeta: DocRenderMeta, isDemo: boolean): DocModel {
    const meta = sanitizeDocMeta(rawMeta);
    const d = computeReceiptData(transactions);
    const covering = formatCovering(meta.coveringFrom, meta.coveringTo);
    const active = d.activeTransactions;

    const { totals, hero, heroLabel } = buildTotals(d, meta);
    const { statement, minoritySource } = sourceReport(active);

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
        sourceStatement: statement,
        lines: active.map(t => buildLine(t, meta, minoritySource)),
        totals,
        disclaimer: `${disclaimerParts.join(' ')} Issued ${issuedDate()}.`,
        isDemo,
    };
}

// ── HTML ─────────────────────────────────────────────────────────────────────

function esc(s: string): string {
    return s.replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

export function renderDocHTML(m: DocModel, qrDataUrl: string, geistWoff2B64?: string): string {
    const lines = m.lines.map(l => {
        const meta = [l.date, l.detail, l.sourceTag].filter(Boolean).join('  ·  ');
        // description and reason share one line via inline layout, so the
        // reason wraps beneath the description when it runs out of room while
        // the amount, in its own column, never moves.
        return `
      <div class="row">
        <div class="rowMain">
          <div class="descLine"><span class="desc">${esc(l.description)}</span>${l.reason ? `<span class="reason"> — ${esc(l.reason)}</span>` : ''}</div>
          ${meta ? `<div class="sub">${esc(meta)}</div>` : ''}
          ${l.items.map(i => `<div class="item"><span>${esc(i.text)}</span><span class="num">${esc(i.amount)}</span></div>`).join('')}
        </div>
        <div class="rowAmt"><div class="num amt">${esc(l.amount)}</div></div>
      </div>`;
    }).join('');

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
  .headRight{display:flex;flex-direction:column;align-items:flex-end;gap:2px;text-align:right}
  .headRight .src{letter-spacing:0;text-transform:none;font-size:9.5px}
  .ctx{font-size:11px;color:${MUTED};margin-bottom:5px}
  hr{border:0;border-top:1px solid ${RULE};margin:14px 0}
  .row{display:flex;justify-content:space-between;align-items:flex-start;gap:14px;padding:9px 0;
    border-bottom:1px solid ${RULE}}
  .row:last-of-type{border-bottom:0}
  .rowMain{flex:1}
  .rowAmt{text-align:right;flex-shrink:0}
  /* description + reason on one line; the reason wraps beneath when long,
     the amount column is fixed and never shifts. */
  .descLine{font-size:13px;line-height:1.35}
  .desc{font-weight:600}
  .reason{font-weight:400}
  .sub{font-size:10.5px;color:${MUTED};margin-top:2px}
  .item{display:flex;justify-content:space-between;gap:10px;font-size:10.5px;color:${MUTED};margin-top:2px;padding-left:10px}
  .num{font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
  .amt{font-weight:600;font-size:13px;white-space:nowrap}
  .tot{display:flex;justify-content:space-between;gap:14px;font-size:12px;color:${MUTED};padding:3px 0}
  .tot.strong{color:${INK};font-weight:700;font-size:14px;padding-top:9px;margin-top:5px;border-top:1px solid ${RULE};
    text-transform:uppercase;letter-spacing:.04em}
  .disc{font-size:10px;color:${MUTED};margin-top:16px;line-height:1.5}
  .demo{margin-top:12px;font-size:11px;font-weight:700;letter-spacing:.08em;color:${MUTED};
    border:1px solid ${RULE};padding:6px 10px;text-align:center}
  .foot{margin-top:22px;padding-top:14px;border-top:1px solid ${RULE};
    display:flex;align-items:center;gap:12px}
  .footText{font-size:10px;color:${MUTED};line-height:1.45}
  @media print{body{background:#fff;padding:0}.doc{box-shadow:none;max-width:none}}
</style>
</head>
<body>
  <div class="doc">
    ${m.brandName ? `<div class="brand">${esc(m.brandName)}</div>` : ''}
    <div class="head">
      <span>${esc(m.typeLabel)}</span>
      <div class="headRight"><span>${esc(m.reference)}</span><span class="src">${esc(m.sourceStatement)}</span></div>
    </div>

    <div class="hero">
      <div class="heroLabel">${esc(m.heroLabel)}</div>
      ${m.heroAmount ? `<div class="heroAmt num">${esc(m.heroAmount)}</div>` : ''}
    </div>
    ${m.contextLine ? `<div class="ctx">${esc(m.contextLine)}</div>` : ''}

    <hr>
    ${lines}
    <hr>

    <div>${totals}</div>

    <div class="disc">${esc(m.disclaimer)}</div>
    ${m.isDemo ? `<div class="demo">${DEMO_LINE}</div>` : ''}

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
    sourceLine: { pt: 7,    bold: false, color: MUTED },
    rowTitle:   { pt: 9.5,  bold: true,  color: INK },
    rowReason:  { pt: 9.5,  bold: false, color: INK },
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

// Run twice: once against a throwaway document to measure the height needed,
// then for real at that exact height. Identical both times, so the measured
// height can never disagree with what gets drawn.
function layout(doc: jsPDF, m: DocModel, qrDataUrl: string | null, family: string): number {
    let y = MARGIN + 3.5;

    if (m.brandName) {
        y = drawWrapped(doc, family, 'brand', m.brandName, MARGIN, y, CONTENT_W);
        y += 0.5;
    }

    // Header row: type label left; reference then the plain-text source
    // statement stacked top-right.
    const headerPt = applyTier(doc, family, 'header');
    doc.text(m.typeLabel, MARGIN, y);
    doc.text(m.reference, PAGE_W - MARGIN, y, { align: 'right' });
    const afterHeader = drawWrapped(doc, family, 'sourceLine', m.sourceStatement, MARGIN, y + lh(headerPt) + 0.6, CONTENT_W, 'right');
    y = Math.max(y + descentMm(headerPt), afterHeader);

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

    y += 2.5;
    y = drawRule(doc, y);

    for (const l of m.lines) {
        const top = y;

        // Description, with the reason after an em-dash on the same line when it
        // fits — otherwise the reason wraps onto its own line beneath, full
        // width. Never truncated. The amount stays on the first line regardless.
        const descPt = applyTier(doc, family, 'rowTitle');
        const descW = doc.getTextWidth(l.description);
        const inlineReason = l.reason ? ` — ${l.reason}` : '';
        const reasonFits = !l.reason || descW + doc.getTextWidth(inlineReason) <= DESC_W;

        doc.text(l.description, MARGIN, y);
        let leftY = y + lh(descPt);
        if (l.reason && reasonFits) {
            applyTier(doc, family, 'rowReason');
            doc.text(inlineReason, MARGIN + descW, y);
        } else if (l.reason) {
            leftY = drawWrapped(doc, family, 'rowReason', l.reason, MARGIN, leftY + 0.4, DESC_W);
        }

        const metaLine = [l.date, l.detail, l.sourceTag].filter(Boolean).join('  ·  ');
        if (metaLine) leftY = drawWrapped(doc, family, 'rowSub', metaLine, MARGIN, leftY + 0.6, DESC_W);
        for (const it of l.items) {
            leftY = drawWrapped(doc, family, 'rowSub', `${it.text}${it.amount ? '   ' + it.amount : ''}`, MARGIN + 2, leftY + 0.3, DESC_W - 2);
        }

        const rightY = drawWrapped(doc, family, 'amount', l.amount, PAGE_W - MARGIN - AMOUNT_COL_W, top, AMOUNT_COL_W, 'right');

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
        doc.setDrawColor(...hex(RULE));
        doc.setLineWidth(0.25);
        doc.rect(MARGIN, y - 3.3, CONTENT_W, 5.2, 'S');
        doc.setFontSize(7);
        doc.setFont(family, 'bold');
        doc.setTextColor(...hex(MUTED));
        doc.text(DEMO_LINE, PAGE_W / 2, y, { align: 'center' });
        y += lh(7) + 2;
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
