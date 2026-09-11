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
// buildDocModel produces a single structured model; the HTML and PDF renderers
// each consume it, which is what guarantees the two can never disagree on a
// figure. There is no per-type fork below the model — the type only changes the
// title, the meta block, the total label and a couple of words.
//
// The look is editorial, not a fintech card: a serif (Source Serif 4, a modern
// financial-report face) for the wordmark, the title, the section headers, the
// body and every monetary figure; the sans (Geist) only for the small
// tracked-caps micro-labels. Grayscale throughout — near-black text on white,
// grays for anything secondary. No colour is used to organise or decorate:
// data source is a plain sentence, not a coloured chip; the page has no border
// or card frame; there is no chart.

const INK = '#1A1A1A';
const MUTED = '#6B6B6B';
const FAINT = '#9A9A9A';
const RULE = '#DCDCDC';
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
    // A quiet "worth a glance" note, joined into the same trailing metadata
    // line as detail and sourceTag rather than given any visual language of
    // its own: currently only the Active Mode direction assumption. Plain
    // words, no chip, no colour — the same convention every other per-row tag
    // in this document uses.
    flagNote: string | null;
}

// One row of the optional bucket breakdown.
export interface DocBucket {
    label: string;
    count: number;
    value: string;
}

export interface DocTotal {
    label: string;
    value: string;
    strong?: boolean;
}

// A labelled field in the per-type meta block. `strong` renders the value in
// the semibold serif (used for the reimbursement claim's party name).
export interface DocMetaField {
    label: string;
    value: string;
    strong?: boolean;
}

export interface DocModel {
    // "M-Track", or the business name for a point_of_sale receipt — the document
    // is meant to read as the merchant's, not the app's.
    wordmark: string;
    // Large serif title: "REIMBURSEMENT CLAIM" / "EXPENSE SUMMARY" /
    // "PERSONAL RECORD" / "SALES RECEIPT".
    title: string;
    reference: string;
    // One plain-text line stating where every figure came from, shown top-right:
    // "Source: all entries from payment messages." /
    // "Source: all entries entered by hand." /
    // "Source: 18 from payment messages, 4 entered by hand." No colour, no badge
    // — the per-row tags (DocLine.sourceTag) carry the mixed case row by row.
    sourceStatement: string;
    // The per-type meta block. `on_behalf_of` gets two fields, rendered as two
    // columns with a thin divider between; the others get zero or one and it
    // renders as a single line.
    metaFields: DocMetaField[];
    // The tracked-caps label above the hero figure: "TOTAL CLAIM" etc.
    totalLabel: string;
    heroAmount: string | null;
    // Small muted line under the hero where one applies (the claim's
    // "Includes expenses and fees"); null otherwise.
    heroSubtitle: string | null;
    // "4 items  ·  10 Aug – 15 Aug 2026" — count and covering span.
    heroMeta: string;
    // The Active Mode bucket breakdown, between the hero total and the
    // itemisation. Empty for every other document — the section is omitted
    // entirely rather than rendered blank. It is a summary in addition to the
    // full itemisation below it, never a replacement for it.
    buckets: DocBucket[];
    // Serif section label above the itemisation: "EXPENSES" / "ITEMS".
    sectionLabel: string;
    // Every included transaction, always. An exported document IS the record —
    // a "+N more" row makes it unusable as the thing someone files or hands
    // over. The chat card's own entrance-animation grouping is a separate,
    // live-only concern and is untouched.
    lines: DocLine[];
    totals: DocTotal[];
    disclaimer: string;
    isDemo: boolean;
}

const TITLE: Record<DocRenderMeta['documentType'], string> = {
    expense_summary: 'EXPENSE SUMMARY',
    personal_note: 'PERSONAL RECORD',
    point_of_sale: 'SALES RECEIPT',
    on_behalf_of: 'REIMBURSEMENT CLAIM',
};

// The tracked-caps label above the hero figure and the bold row in the totals
// block always agree — both read from here.
const TOTAL_LABEL: Record<DocRenderMeta['documentType'], string> = {
    expense_summary: 'TOTAL SPENT',
    personal_note: 'TOTAL',
    point_of_sale: 'TOTAL PAID',
    on_behalf_of: 'TOTAL CLAIM',
};

const SECTION_LABEL: Record<DocRenderMeta['documentType'], string> = {
    expense_summary: 'EXPENSES',
    personal_note: 'EXPENSES',
    point_of_sale: 'ITEMS',
    on_behalf_of: 'EXPENSES',
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

    // Active Mode fills in a direction it could not resolve rather than
    // stopping a vendor mid-rush to ask (see activeMode/direction.ts). The
    // document says so, quietly, so the assumption is reviewable.
    const flagNote = t.directionAssumed ? 'money in assumed' : null;

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
        flagNote,
    };
}

function buildMetaFields(meta: DocRenderMeta, covering: string): DocMetaField[] {
    if (meta.documentType === 'on_behalf_of') {
        const fields: DocMetaField[] = [
            { label: 'Prepared for', value: meta.onBehalfOf?.partyName || 'Unknown', strong: true },
        ];
        if (meta.onBehalfOf?.purpose) fields.push({ label: 'Purpose', value: meta.onBehalfOf.purpose });
        else if (covering) fields.push({ label: 'Covering', value: covering });
        return fields;
    }
    if (meta.documentType === 'point_of_sale') {
        const fields: DocMetaField[] = [];
        if (meta.merchantProfile?.contact) fields.push({ label: 'Contact', value: meta.merchantProfile.contact });
        if (covering) fields.push({ label: 'Date', value: covering });
        return fields.slice(0, 1);
    }
    // expense_summary / personal_note: the real covering span, never a relative
    // label, left out entirely when there isn't one. (There is no free-text
    // note field on the meta, so personal_note carries the same covering line;
    // the per-line reasons carry what each entry was for.)
    return covering ? [{ label: 'Covering', value: covering }] : [];
}

function buildTotals(d: ReceiptData, meta: DocRenderMeta): { totals: DocTotal[]; hero: string | null } {
    const boldLabel = TOTAL_LABEL[meta.documentType];

    if (d.isMultiCurrency) {
        // Two currencies never become one figure.
        const totals: DocTotal[] = [];
        for (const pc of d.perCurrency) {
            totals.push({ label: `${pc.currency}, ${pc.count} item${pc.count === 1 ? '' : 's'}`, value: fmtCurrency(pc.amount, pc.currency) });
            if (pc.cost > 0) totals.push({ label: `${pc.currency} fees`, value: fmtCurrency(pc.cost, pc.currency) });
            totals.push({ label: `${boldLabel} (${pc.currency})`, value: fmtCurrency(pc.total, pc.currency), strong: true });
        }
        return { totals, hero: null };
    }

    if (meta.documentType === 'on_behalf_of') {
        const ct = claimTotals(d);
        const totals: DocTotal[] = [
            { label: `Subtotal, ${ct.itemCount} item${ct.itemCount === 1 ? '' : 's'}`, value: fmt(ct.subtotal) },
        ];
        if (ct.transactionCosts > 0) totals.push({ label: 'Transaction fees', value: fmt(ct.transactionCosts) });
        totals.push({ label: boldLabel, value: fmt(ct.totalDue), strong: true });
        return { totals, hero: fmt(ct.totalDue) };
    }

    const totals: DocTotal[] = [
        { label: `Subtotal, ${d.totalTransactionCount} item${d.totalTransactionCount === 1 ? '' : 's'}`, value: fmt(d.totalTransactionAmount) },
    ];
    if (d.totalTransactionCost > 0) totals.push({ label: 'Transaction fees', value: fmt(d.totalTransactionCost) });
    totals.push({ label: boldLabel, value: fmt(d.grandTotal), strong: true });
    return { totals, hero: fmt(d.grandTotal) };
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

// The Active Mode bucket breakdown: one row per bucket that actually has
// something in it, in descending order of takings, with anything unfiled last
// under "Unsorted".
//
// Returns nothing at all unless this document came from Active Mode AND some
// transaction carries a bucket — a document with no bucket usage omits the
// section rather than rendering an empty one. Every transaction still appears
// individually in the itemisation below regardless; this is a summary on top
// of that, not instead of it.
const UNSORTED_BUCKET = 'Unsorted';

function buildBuckets(meta: DocRenderMeta, active: ParsedTransaction[]): DocBucket[] {
    if (!meta.capturedViaActiveMode) return [];
    if (!active.some(t => t.bucketLabel)) return [];

    const groups = new Map<string, { count: number; amount: number; currency: string }>();
    for (const t of active) {
        const key = t.bucketLabel?.trim() || UNSORTED_BUCKET;
        const g = groups.get(key) ?? { count: 0, amount: 0, currency: t.currency };
        g.count += 1;
        g.amount += t.amount;
        groups.set(key, g);
    }

    return [...groups.entries()]
        .sort(([aName, a], [bName, b]) => {
            // Unsorted is a leftovers bin, not a category — it sits last
            // however much is in it.
            if (aName === UNSORTED_BUCKET) return 1;
            if (bName === UNSORTED_BUCKET) return -1;
            return b.amount - a.amount;
        })
        .map(([label, g]) => ({ label, count: g.count, value: fmtCurrency(g.amount, g.currency) }));
}

export function buildDocModel(transactions: ParsedTransaction[], rawMeta: DocRenderMeta, isDemo: boolean): DocModel {
    const meta = sanitizeDocMeta(rawMeta);
    const d = computeReceiptData(transactions);
    const covering = formatCovering(meta.coveringFrom, meta.coveringTo);
    const active = d.activeTransactions;

    const { totals, hero } = buildTotals(d, meta);
    const { statement, minoritySource } = sourceReport(active);

    const disclaimerParts = [...baseDisclaimerLines(meta.documentType)];
    const trust = trustDisclaimerLine(meta.dataSource, meta.documentType);
    if (trust) disclaimerParts.push(trust);

    const count = d.isMultiCurrency ? active.length : d.totalTransactionCount;
    const heroMeta = [
        `${count} item${count === 1 ? '' : 's'}`,
        covering || null,
    ].filter(Boolean).join('  ·  ');

    return {
        wordmark: meta.documentType === 'point_of_sale'
            ? (meta.merchantProfile?.businessName || 'Receipt')
            : 'M-Track',
        title: TITLE[meta.documentType],
        reference: d.receiptRef,
        sourceStatement: statement,
        metaFields: buildMetaFields(meta, covering),
        totalLabel: TOTAL_LABEL[meta.documentType],
        heroAmount: hero,
        heroSubtitle: meta.documentType === 'on_behalf_of' && d.totalTransactionCost > 0
            ? 'Includes expenses and fees'
            : null,
        heroMeta,
        buckets: buildBuckets(meta, active),
        sectionLabel: SECTION_LABEL[meta.documentType],
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

export interface DocWebFonts {
    serifWoff2?: string;
    sansWoff2?: string;
}

export function renderDocHTML(m: DocModel, qrDataUrl: string, fonts: DocWebFonts = {}): string {
    const lineRows = m.lines.map(l => {
        const sub = [l.detail, l.sourceTag, l.flagNote].filter(Boolean).join('  ·  ');
        return `
      <div class="row">
        <div class="rowDate">${esc(l.date)}</div>
        <div class="rowMain">
          <div class="descLine"><span class="desc">${esc(l.description)}</span>${l.reason ? `<span class="reason"> — ${esc(l.reason)}</span>` : ''}</div>
          ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
          ${l.items.map(i => `<div class="item"><span>${esc(i.text)}</span><span class="num">${esc(i.amount)}</span></div>`).join('')}
        </div>
        <div class="rowAmt num">${esc(l.amount)}</div>
      </div>`;
    }).join('');

    const totals = m.totals.map(t => `
      <div class="tot ${t.strong ? 'strong' : ''}">
        <span class="totLabel">${esc(t.label)}</span><span class="num">${esc(t.value)}</span>
      </div>`).join('');

    // The bucket breakdown. Same typography as the totals block — a serif
    // micro-label, plain rows, a rule above and below — because it is the same
    // kind of thing: a summary of figures itemised in full further down.
    const bucketBlock = m.buckets.length === 0 ? '' : `
    <hr class="ruleTight">
    <div class="section">Buckets</div>
    <div class="bucketRows">
      ${m.buckets.map(b => `
      <div class="bucket">
        <span class="bucketLabel">${esc(b.label)}</span>
        <span class="bucketCount">${b.count} ${b.count === 1 ? 'item' : 'items'}</span>
        <span class="num bucketValue">${esc(b.value)}</span>
      </div>`).join('')}
    </div>`;

    const twoCol = m.metaFields.length === 2;
    const metaBlock = m.metaFields.length === 0 ? '' : `
    <div class="meta ${twoCol ? 'metaCols' : ''}">
      ${m.metaFields.map(f => `<div class="metaField"><div class="metaLabel">${esc(f.label)}</div><div class="metaValue ${f.strong ? 'strong' : ''}">${esc(f.value)}</div></div>`).join('')}
    </div>`;

    const serifStack = `${fonts.serifWoff2 ? "'Source Serif 4 Web'," : ''}Georgia,'Times New Roman',serif`;
    const sansStack = `${fonts.sansWoff2 ? "'Geist Web'," : ''}-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(m.wordmark)} ${esc(m.reference)}</title>
<style>
  ${fonts.serifWoff2 ? `@font-face{font-family:'Source Serif 4 Web';src:url(data:font/woff2;base64,${fonts.serifWoff2}) format('woff2');font-weight:200 900;font-style:normal;font-display:swap}` : ''}
  ${fonts.sansWoff2 ? `@font-face{font-family:'Geist Web';src:url(data:font/woff2;base64,${fonts.sansWoff2}) format('woff2');font-weight:100 900;font-style:normal;font-display:swap}` : ''}
  *{box-sizing:border-box;margin:0;padding:0}
  body{background:#EDEDED;display:flex;justify-content:center;padding:40px 16px;
    font-family:${serifStack};color:${INK};font-size:14px;line-height:1.5;
    -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;
    font-variant-numeric:tabular-nums;font-feature-settings:"tnum" 1}
  .page{background:${PAPER};width:100%;max-width:460px;padding:48px 44px 36px}
  .page,.page *{word-wrap:break-word;overflow-wrap:break-word;min-width:0}
  .num{font-variant-numeric:tabular-nums lining-nums;font-feature-settings:"tnum" 1,"lnum" 1}
  .micro{font-family:${sansStack};font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:${MUTED}}

  .head{display:flex;justify-content:space-between;align-items:baseline;gap:16px}
  .wordmark{font-size:17px;font-weight:600;letter-spacing:.01em;color:${INK}}
  .headRight{font-family:${sansStack};text-align:right;display:flex;flex-direction:column;gap:3px}
  .ref{font-size:9.5px;letter-spacing:.11em;text-transform:uppercase;color:${FAINT}}
  .src{font-size:10px;color:${MUTED};max-width:210px}
  .title{font-size:25px;font-weight:600;letter-spacing:.005em;line-height:1.15;margin-top:22px;color:${INK}}

  .meta{margin-top:16px}
  .meta.metaCols{display:grid;grid-template-columns:1fr 1fr;gap:0}
  .meta.metaCols .metaField:last-child{padding-left:20px;border-left:1px solid ${RULE}}
  .metaField+.metaField{margin-top:8px}
  .metaCols .metaField+.metaField{margin-top:0}
  .metaLabel{font-family:${sansStack};font-size:9px;letter-spacing:.11em;text-transform:uppercase;color:${MUTED};margin-bottom:3px}
  .metaValue{font-size:13px;color:${INK}}
  .metaValue.strong{font-weight:600}

  .rule{border:0;border-top:1px solid ${RULE};margin:22px 0}
  .ruleTight{border:0;border-top:1px solid ${RULE};margin:10px 0}

  .totalBlock{margin:22px 0}
  .totalLabel{font-family:${sansStack};font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:${MUTED}}
  .hero{font-size:38px;font-weight:600;letter-spacing:-.01em;line-height:1.1;margin-top:6px;color:${INK}}
  .heroSub{font-size:12px;color:${MUTED};margin-top:5px}
  .heroMeta{font-family:${sansStack};font-size:10.5px;color:${MUTED};margin-top:7px}

  .bucketRows{margin-top:6px}
  .bucket{display:flex;align-items:baseline;gap:10px;font-size:12.5px;padding:3px 0;color:${INK}}
  .bucketLabel{flex:1;min-width:0}
  .bucketCount{font-family:${sansStack};font-size:10px;color:${MUTED};white-space:nowrap}
  .bucketValue{flex-shrink:0;text-align:right;white-space:nowrap}

  .section{font-size:14px;font-weight:600;letter-spacing:.02em;text-transform:uppercase;color:${INK};margin-bottom:8px}
  .colHead{display:flex;gap:12px;font-family:${sansStack};font-size:8.5px;letter-spacing:.11em;text-transform:uppercase;color:${FAINT};padding-bottom:6px;border-bottom:1px solid ${RULE};margin-bottom:2px}
  .colHead .cDate{width:66px;flex-shrink:0}
  .colHead .cD{flex:1}
  .colHead .cAmt{flex-shrink:0;text-align:right}

  .row{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid ${RULE}}
  .row:last-of-type{border-bottom:0}
  .rowDate{font-family:${sansStack};font-size:10px;color:${MUTED};width:66px;flex-shrink:0;padding-top:2px}
  .rowMain{flex:1}
  .rowAmt{flex-shrink:0;text-align:right;font-size:13.5px;white-space:nowrap;padding-top:1px}
  .descLine{font-size:13.5px;line-height:1.35}
  .desc{font-weight:600}
  .reason{font-weight:400}
  .sub{font-family:${sansStack};font-size:10px;color:${MUTED};margin-top:3px}
  .item{display:flex;justify-content:space-between;gap:10px;font-size:11px;color:${MUTED};margin-top:3px;padding-left:12px}

  .tot{display:flex;justify-content:space-between;gap:14px;font-size:12.5px;color:${MUTED};padding:3px 0}
  .tot .totLabel{font-family:${serifStack};letter-spacing:0;text-transform:none;font-size:12.5px;color:${MUTED}}
  .tot.strong{color:${INK};padding-top:10px;margin-top:6px;border-top:1px solid ${RULE}}
  .tot.strong .totLabel{font-family:${sansStack};font-size:10px;letter-spacing:.13em;text-transform:uppercase;color:${INK}}
  .tot.strong .num{font-size:16px;font-weight:600}

  .disc{font-family:${sansStack};font-size:9.5px;color:${MUTED};margin-top:24px;line-height:1.55}
  .demo{margin-top:14px;font-family:${sansStack};font-size:10px;font-weight:500;letter-spacing:.18em;color:${FAINT};text-align:center}
  .foot{margin-top:28px;padding-top:16px;border-top:1px solid ${RULE};display:flex;align-items:center;gap:12px}
  .footText{font-family:${sansStack};font-size:9.5px;color:${MUTED};line-height:1.45}
  @media print{body{background:#fff;padding:0}.page{max-width:none}}
</style>
</head>
<body>
  <div class="page">
    <div class="head">
      <span class="wordmark">${esc(m.wordmark)}</span>
      <span class="headRight">
        <span class="ref">${esc(m.reference)}</span>
        <span class="src">${esc(m.sourceStatement)}</span>
      </span>
    </div>
    <div class="title">${esc(m.title)}</div>
    ${metaBlock}

    <hr class="rule">

    <div class="totalBlock">
      <div class="totalLabel">${esc(m.totalLabel)}</div>
      ${m.heroAmount ? `<div class="hero num">${esc(m.heroAmount)}</div>` : `<div class="hero num" style="font-size:20px">Totalled by currency</div>`}
      ${m.heroSubtitle ? `<div class="heroSub">${esc(m.heroSubtitle)}</div>` : ''}
      <div class="heroMeta">${esc(m.heroMeta)}</div>
    </div>

    ${bucketBlock}

    <hr class="rule">

    <div class="section">${esc(m.sectionLabel)}</div>
    <div class="colHead"><span class="cDate">Date</span><span class="cD">Description</span><span class="cAmt">Amount</span></div>
    <div class="rows">${lineRows}</div>

    <hr class="ruleTight">
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

// An editorial page: generous margins, no border, no card. Plain white.
const PAGE_W = 112;              // mm
const MARGIN = 11;               // generous side / top / bottom margin
const CONTENT_W = PAGE_W - MARGIN * 2;
const DATE_COL_W = 15;           // the itemisation's left Date column
const AMOUNT_COL_W = 23;         // the itemisation's right Amount column
const COL_GAP = 3;
// Width for the description + an inline reason. A standalone (wrapped) reason
// is given the full width beneath the first line instead — see layout().
const DESC_W = CONTENT_W - DATE_COL_W - AMOUNT_COL_W - COL_GAP * 2;
const MAX_PAGE_MM = 5000;        // jsPDF's hard ceiling is ~14400 units; stay inside

function hex(h: string): [number, number, number] {
    return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

const PT_TO_MM = 0.352777;

// Line height in mm for a run of type at `sizePt`.
function lh(sizePt: number): number { return sizePt * 0.42; }

// Roughly how far a line of type at `sizePt` reaches above / below its baseline,
// in mm — for stacking two differently-sized elements without their glyph boxes
// colliding. jsPDF's text() advances nothing on its own.
function ascentMm(sizePt: number): number { return sizePt * PT_TO_MM * 0.80; }
function descentMm(sizePt: number): number { return sizePt * PT_TO_MM * 0.24; }

// The type scale. `font` picks the family (serif for everything structural and
// numeric, sans only for tracked micro-labels); `track` is letter-spacing in mm
// passed straight to jsPDF's charSpace.
const TYPE = {
    wordmark:   { pt: 13,   font: 'serif' as const, bold: true,  color: INK,   track: 0 },
    title:      { pt: 17,   font: 'serif' as const, bold: true,  color: INK,   track: 0.1 },
    ref:        { pt: 6.5,  font: 'sans'  as const, bold: false, color: FAINT, track: 0.35 },
    source:     { pt: 7,    font: 'sans'  as const, bold: false, color: MUTED, track: 0 },
    metaLabel:  { pt: 6,    font: 'sans'  as const, bold: false, color: MUTED, track: 0.35 },
    metaValue:  { pt: 9,    font: 'serif' as const, bold: false, color: INK,   track: 0 },
    metaValueStrong: { pt: 9, font: 'serif' as const, bold: true, color: INK,  track: 0 },
    totalLabel: { pt: 7,    font: 'sans'  as const, bold: false, color: MUTED, track: 0.45 },
    hero:       { pt: 27,   font: 'serif' as const, bold: true,  color: INK,   track: 0 },
    heroSub:    { pt: 8,    font: 'serif' as const, bold: false, color: MUTED, track: 0 },
    heroMeta:   { pt: 7,    font: 'sans'  as const, bold: false, color: MUTED, track: 0 },
    section:    { pt: 10,   font: 'serif' as const, bold: true,  color: INK,   track: 0.2 },
    colHead:    { pt: 5.6,  font: 'sans'  as const, bold: false, color: FAINT, track: 0.35 },
    rowDate:    { pt: 7,    font: 'sans'  as const, bold: false, color: MUTED, track: 0 },
    rowTitle:   { pt: 9.5,  font: 'serif' as const, bold: true,  color: INK,   track: 0 },
    rowReason:  { pt: 9.5,  font: 'serif' as const, bold: false, color: INK,   track: 0 },
    rowSub:     { pt: 6.6,  font: 'sans'  as const, bold: false, color: MUTED, track: 0 },
    amount:     { pt: 9.5,  font: 'serif' as const, bold: false, color: INK,   track: 0 },
    totLabel:   { pt: 8.5,  font: 'serif' as const, bold: false, color: MUTED, track: 0 },
    totValue:   { pt: 8.5,  font: 'serif' as const, bold: false, color: MUTED, track: 0 },
    totStrongLabel: { pt: 7, font: 'sans' as const, bold: false, color: INK,   track: 0.45 },
    totStrongValue: { pt: 12.5, font: 'serif' as const, bold: true, color: INK, track: 0 },
    disclaimer: { pt: 6.2,  font: 'sans'  as const, bold: false, color: MUTED, track: 0 },
    demo:       { pt: 7,    font: 'sans'  as const, bold: false, color: FAINT, track: 0.6 },
    footer:     { pt: 6.2,  font: 'sans'  as const, bold: false, color: MUTED, track: 0 },
} as const;
type Tier = keyof typeof TYPE;

export interface PdfFontData {
    // base64 TrueType (glyf) instances — jsPDF 4.x parses glyf only.
    serifRegular: string;
    serifBold: string;
    sans: string;
}

interface Families { serif: string; sans: string }

// Registers the embedded faces on a jsPDF instance and returns the family names
// to use, falling back to Helvetica for either family if its embed fails for any
// reason. The fallback is logged, never silent — this exists so a generic-font
// regression is observable rather than shipped quietly.
function registerFonts(doc: jsPDF, fonts: PdfFontData): Families {
    const out: Families = { serif: 'helvetica', sans: 'helvetica' };
    try {
        doc.addFileToVFS('SourceSerif4-Regular.ttf', fonts.serifRegular);
        doc.addFont('SourceSerif4-Regular.ttf', 'SourceSerif4', 'normal');
        doc.addFileToVFS('SourceSerif4-Bold.ttf', fonts.serifBold);
        doc.addFont('SourceSerif4-Bold.ttf', 'SourceSerif4', 'bold');
        doc.setFont('SourceSerif4', 'normal');
        doc.getTextWidth('0');
        out.serif = 'SourceSerif4';
    } catch (err) {
        if (typeof console !== 'undefined') {
            console.warn('PDF export: Source Serif 4 embed failed, falling back to Helvetica.', err);
        }
    }
    try {
        doc.addFileToVFS('Geist-Regular.ttf', fonts.sans);
        doc.addFont('Geist-Regular.ttf', 'Geist', 'normal');
        doc.setFont('Geist', 'normal');
        doc.getTextWidth('0');
        out.sans = 'Geist';
    } catch (err) {
        if (typeof console !== 'undefined') {
            console.warn('PDF export: Geist embed failed, falling back to Helvetica.', err);
        }
    }
    return out;
}

function applyTier(doc: jsPDF, fam: Families, tier: Tier): { pt: number; track: number } {
    const t = TYPE[tier];
    doc.setFontSize(t.pt);
    doc.setFont(t.font === 'serif' ? fam.serif : fam.sans, t.bold ? 'bold' : 'normal');
    doc.setTextColor(...hex(t.color));
    return { pt: t.pt, track: t.track };
}

// Every string the layout draws goes through here or drawLine. jsPDF does not
// wrap — it runs straight past the page edge — so splitTextToSize against the
// column width is not optional.
function drawWrapped(
    doc: jsPDF, fam: Families, tier: Tier, text: string,
    x: number, y: number, width: number, align: 'left' | 'right' = 'left',
): number {
    if (!text) return y;
    const { pt, track } = applyTier(doc, fam, tier);
    for (const part of doc.splitTextToSize(text, width) as string[]) {
        doc.text(part, align === 'right' ? x + width : x, y, { align, charSpace: track });
        y += lh(pt);
    }
    return y;
}

function drawRule(doc: jsPDF, y: number, from = MARGIN, to = PAGE_W - MARGIN): number {
    doc.setDrawColor(...hex(RULE));
    doc.setLineWidth(0.2);
    doc.line(from, y, to, y);
    return y;
}

// Run twice: once against a throwaway document to measure the height needed,
// then for real at that exact height. Identical both times, so the measured
// height can never disagree with what gets drawn.
function layout(doc: jsPDF, m: DocModel, qrDataUrl: string | null, fam: Families): number {
    let y = MARGIN + 4;

    // ── Header row: wordmark left (serif), reference + source right (sans).
    //    Each side keeps to its own column and wraps within it, so a long
    //    business name and a long mixed-source sentence never collide. ──
    const wmColW = CONTENT_W * 0.46;
    const rightColW = CONTENT_W * 0.50;
    const rightX = PAGE_W - MARGIN - rightColW;
    const wm = applyTier(doc, fam, 'wordmark');
    let wmY = y;
    for (const part of doc.splitTextToSize(m.wordmark, wmColW) as string[]) {
        doc.text(part, MARGIN, wmY, { charSpace: wm.track });
        wmY += lh(wm.pt);
    }
    const wmBottom = wmY - lh(wm.pt) + descentMm(wm.pt);
    const refY = y - ascentMm(wm.pt) + ascentMm(TYPE.ref.pt);
    applyTier(doc, fam, 'ref');
    doc.text(m.reference, PAGE_W - MARGIN, refY, { align: 'right', charSpace: TYPE.ref.track });
    const srcBottom = drawWrapped(doc, fam, 'source', m.sourceStatement,
        rightX, refY + lh(TYPE.ref.pt) + 0.6, rightColW, 'right');
    y = Math.max(wmBottom, srcBottom);

    // ── Title. ──
    y += 6;
    const ti = applyTier(doc, fam, 'title');
    y += ascentMm(ti.pt);
    for (const part of doc.splitTextToSize(m.title, CONTENT_W) as string[]) {
        doc.text(part, MARGIN, y, { charSpace: ti.track });
        y += lh(ti.pt);
    }
    y += descentMm(ti.pt);

    // ── Meta block. Two fields -> two columns with a thin divider. ──
    if (m.metaFields.length > 0) {
        y += 4;
        if (m.metaFields.length >= 2) {
            const colW = (CONTENT_W - 8) / 2;
            const leftX = MARGIN;
            const rightX = MARGIN + colW + 8;
            const startY = y;
            let ly = drawWrapped(doc, fam, 'metaLabel', m.metaFields[0].label.toUpperCase(), leftX, startY, colW);
            ly = drawWrapped(doc, fam, m.metaFields[0].strong ? 'metaValueStrong' : 'metaValue', m.metaFields[0].value, leftX, ly + 1.2, colW);
            let ry = drawWrapped(doc, fam, 'metaLabel', m.metaFields[1].label.toUpperCase(), rightX, startY, colW);
            ry = drawWrapped(doc, fam, m.metaFields[1].strong ? 'metaValueStrong' : 'metaValue', m.metaFields[1].value, rightX, ry + 1.2, colW);
            const bottom = Math.max(ly, ry);
            doc.setDrawColor(...hex(RULE));
            doc.setLineWidth(0.2);
            doc.line(MARGIN + colW + 4, startY - ascentMm(TYPE.metaLabel.pt), MARGIN + colW + 4, bottom - lh(TYPE.metaValue.pt) + descentMm(TYPE.metaValue.pt));
            y = bottom;
        } else {
            const f = m.metaFields[0];
            const ly = drawWrapped(doc, fam, 'metaLabel', f.label.toUpperCase(), MARGIN, y, CONTENT_W);
            y = drawWrapped(doc, fam, f.strong ? 'metaValueStrong' : 'metaValue', f.value, MARGIN, ly + 1.2, CONTENT_W);
        }
    }

    // ── Rule. ──
    y += 5;
    drawRule(doc, y);
    y += 7;

    // ── Total block: tracked-caps label, serif hero, subtitle, meta line. ──
    const tl = applyTier(doc, fam, 'totalLabel');
    doc.text(m.totalLabel, MARGIN, y, { charSpace: tl.track });
    if (m.heroAmount) {
        y += descentMm(tl.pt) + ascentMm(TYPE.hero.pt) + 2.2;
        const h = applyTier(doc, fam, 'hero');
        doc.text(m.heroAmount, MARGIN, y, { charSpace: h.track });
        y += descentMm(h.pt);
    } else {
        y += descentMm(tl.pt) + ascentMm(TYPE.heroSub.pt) + 2;
        const h = applyTier(doc, fam, 'heroSub');
        doc.text('Totalled by currency', MARGIN, y, { charSpace: h.track });
        y += descentMm(TYPE.heroSub.pt);
    }
    if (m.heroSubtitle) y = drawWrapped(doc, fam, 'heroSub', m.heroSubtitle, MARGIN, y + 3, CONTENT_W);
    y = drawWrapped(doc, fam, 'heroMeta', m.heroMeta, MARGIN, y + 3.4, CONTENT_W);

    // ── Rule. ──
    y += 3.5;
    drawRule(doc, y);
    y += 7;

    // ── Bucket breakdown, when this document came from Active Mode and has
    //    buckets. Between the hero and the itemisation, in the same typography
    //    as the totals block: a serif section label, then label / count /
    //    value rows. Omitted entirely when there is nothing to show. ──
    if (m.buckets.length > 0) {
        const bsec = applyTier(doc, fam, 'section');
        y += ascentMm(bsec.pt);
        doc.text('BUCKETS', MARGIN, y, { charSpace: bsec.track });
        y += descentMm(bsec.pt) + 2.4;
        drawRule(doc, y);
        y += 4.4;

        const countW = 20;
        const valueX = PAGE_W - MARGIN;
        for (const b of m.buckets) {
            // The value first, so the label knows how much room it has and
            // wraps inside it rather than running through the figure.
            const { pt } = applyTier(doc, fam, 'totValue');
            const valueW = doc.getTextWidth(b.value);
            doc.text(b.value, valueX, y, { align: 'right' });

            applyTier(doc, fam, 'rowSub');
            doc.text(`${b.count} ${b.count === 1 ? 'item' : 'items'}`,
                valueX - valueW - 3, y, { align: 'right' });

            const labelW = CONTENT_W - valueW - countW - 6;
            const labelBottom = drawWrapped(doc, fam, 'totLabel', b.label, MARGIN, y, labelW);
            y = Math.max(labelBottom, y + lh(pt));
        }
        y += 1.6;
        drawRule(doc, y);
        y += 7;
    }

    // ── Itemisation. Serif section label, then a tracked-caps column header
    //    over a thin rule, then every line as its own row with a hairline
    //    divider. ──
    const sec = applyTier(doc, fam, 'section');
    y += ascentMm(sec.pt);
    doc.text(m.sectionLabel, MARGIN, y, { charSpace: sec.track });
    y += descentMm(sec.pt) + 3.4;

    const ch = applyTier(doc, fam, 'colHead');
    doc.text('DATE', MARGIN, y, { charSpace: ch.track });
    doc.text('DESCRIPTION', MARGIN + DATE_COL_W + COL_GAP, y, { charSpace: ch.track });
    doc.text('AMOUNT', PAGE_W - MARGIN, y, { align: 'right', charSpace: ch.track });
    y += 1.8;
    drawRule(doc, y);
    y += 3.6;

    const descX = MARGIN + DATE_COL_W + COL_GAP;
    for (const l of m.lines) {
        const top = y;

        // Date column (sans, muted), wrapping within its narrow column.
        const dateBottom = drawWrapped(doc, fam, 'rowDate', l.date, MARGIN, top, DATE_COL_W);

        // Description, with the reason after an em-dash on the same line when it
        // fits — otherwise the reason wraps onto its own line(s) beneath,
        // spanning the full content width (the amount is only ever on the first
        // line, so nothing collides). Never truncated.
        //
        // The description wraps too: a long recipient name
        // ("CO-OPERATIVE BANK COLLECTION ACCOUNT") is split against DESC_W and
        // every line drawn, with the cursor advanced by the real line count.
        // Assuming a single line here is what used to drop the Ref/fee line,
        // the category and the next row on top of the name's second line.
        const fullW = PAGE_W - MARGIN - descX;
        const dt = applyTier(doc, fam, 'rowTitle');
        const descParts = doc.splitTextToSize(l.description, DESC_W) as string[];
        // An inline reason continues from the end of the *last* description line.
        const lastDescW = doc.getTextWidth(descParts[descParts.length - 1] ?? '');
        const inlineReason = l.reason ? ` — ${l.reason}` : '';
        applyTier(doc, fam, 'rowReason');
        const reasonFits = !l.reason || lastDescW + doc.getTextWidth(inlineReason) <= DESC_W;

        applyTier(doc, fam, 'rowTitle');
        let leftY = top;
        for (const part of descParts) {
            doc.text(part, descX, leftY);
            leftY += lh(dt.pt);
        }
        if (l.reason && reasonFits) {
            applyTier(doc, fam, 'rowReason');
            doc.text(inlineReason, descX + lastDescW, leftY - lh(dt.pt));
        } else if (l.reason) {
            leftY = drawWrapped(doc, fam, 'rowReason', l.reason, descX, leftY + 0.4, fullW);
        }

        const sub = [l.detail, l.sourceTag, l.flagNote].filter(Boolean).join('  ·  ');
        if (sub) leftY = drawWrapped(doc, fam, 'rowSub', sub, descX, leftY + 0.8, fullW);
        for (const it of l.items) {
            leftY = drawWrapped(doc, fam, 'rowSub', `${it.text}${it.amount ? '   ' + it.amount : ''}`, descX + 2, leftY + 0.4, fullW - 2);
        }

        const rightY = drawWrapped(doc, fam, 'amount', l.amount, PAGE_W - MARGIN - AMOUNT_COL_W, top, AMOUNT_COL_W, 'right');

        y = Math.max(leftY, rightY, dateBottom) + 3;
        drawRule(doc, y - 1.6);
    }

    // ── Totals: subtotal + explicit fee rows, then the bold final row. ──
    y += 3.5;
    for (const t of m.totals) {
        if (t.strong) {
            y += 2.5;
            drawRule(doc, y - 1.6);
            y += 2.5;
            const lab = applyTier(doc, fam, 'totStrongLabel');
            y += ascentMm(TYPE.totStrongValue.pt);
            doc.text(t.label.toUpperCase(), MARGIN, y, { charSpace: lab.track });
            const v = applyTier(doc, fam, 'totStrongValue');
            doc.text(t.value, PAGE_W - MARGIN, y, { align: 'right', charSpace: v.track });
            y += descentMm(TYPE.totStrongValue.pt);
        } else {
            const { pt } = applyTier(doc, fam, 'totLabel');
            const valueW = doc.getTextWidth(t.value);
            const parts = doc.splitTextToSize(t.label, CONTENT_W - valueW - 4) as string[];
            applyTier(doc, fam, 'totLabel');
            doc.text(parts[0], MARGIN, y);
            applyTier(doc, fam, 'totValue');
            doc.text(t.value, PAGE_W - MARGIN, y, { align: 'right' });
            y += lh(pt);
            applyTier(doc, fam, 'totLabel');
            for (const extra of parts.slice(1)) { doc.text(extra, MARGIN, y); y += lh(pt); }
        }
    }

    // ── Disclaimer. ──
    y += 7;
    y = drawWrapped(doc, fam, 'disclaimer', m.disclaimer, MARGIN, y, CONTENT_W);

    if (m.isDemo) {
        const dm = applyTier(doc, fam, 'demo');
        y += 4 + ascentMm(dm.pt);
        doc.text(DEMO_LINE, PAGE_W / 2, y, { align: 'center', charSpace: dm.track });
        y += descentMm(dm.pt);
    }

    // ── Footer. ──
    y += 8;
    drawRule(doc, y);
    y += 4;
    const qrSize = 13;
    if (qrDataUrl) doc.addImage(qrDataUrl, 'PNG', MARGIN, y, qrSize, qrSize);
    applyTier(doc, fam, 'footer');
    doc.text('Made with M-Track', MARGIN + qrSize + 4, y + 5.2);
    doc.text('mtrack.vercel.app', MARGIN + qrSize + 4, y + 5.2 + lh(TYPE.footer.pt));
    y += qrSize + 1.5;

    return y;
}

export interface DrawnString {
    text: string;
    left: number;
    right: number;
    y: number;
    top: number;
    bottom: number;
    sizePt: number;
    bold: boolean;
    color: string;
    fontName: string;
}

// Every string the PDF layout actually draws, with its measured box in mm.
// Exists so overflow / overlap / a flattened type hierarchy can be
// regression-tested directly — jsPDF does not wrap, so "it looked fine" is not a
// check. jsPDF assigns text() as an own property per instance, which is why
// this lives next to the layout. Pass `fonts` to measure with the real embedded
// typefaces rather than Helvetica.
export function measureDrawnStrings(m: DocModel, fonts?: PdfFontData): DrawnString[] {
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, 4000] });
    const fam: Families = fonts ? registerFonts(doc, fonts) : { serif: 'helvetica', sans: 'helvetica' };
    doc.setFont(fam.serif, 'normal');
    const drawn: DrawnString[] = [];
    const original = doc.text.bind(doc);
    (doc as unknown as { text: unknown }).text = function (
        text: string | string[], x: number, y: number, opts?: { align?: string; charSpace?: number },
    ) {
        const sizePt = doc.getFontSize();
        const sizeMm = sizePt * PT_TO_MM;
        const f = doc.getFont();
        const style = String(f?.fontStyle ?? '').toLowerCase();
        const color = (() => { try { return String(doc.getTextColor()); } catch { return ''; } })();
        for (const part of Array.isArray(text) ? text : [String(text)]) {
            const w = doc.getTextWidth(part) + (opts?.charSpace ?? 0) * Math.max(0, part.length - 1);
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
    layout(doc, m, null, fam);
    return drawn;
}

export const PDF_PAGE_WIDTH_MM = PAGE_W;
export const PDF_MARGIN_MM = MARGIN;

export function renderDocPDF(m: DocModel, qrDataUrl: string, fonts?: PdfFontData): Blob {
    // Pass 1 — measure on a tall scratch page so nothing clips while sizing.
    const scratch = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, 4000] });
    const fam1: Families = fonts ? registerFonts(scratch, fonts) : { serif: 'helvetica', sans: 'helvetica' };
    scratch.setFont(fam1.serif, 'normal');
    const contentBottom = layout(scratch, m, null, fam1);

    const pageH = Math.max(120, Math.min(contentBottom + MARGIN, MAX_PAGE_MM));
    const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: [PAGE_W, pageH] });
    const fam2: Families = fonts ? registerFonts(doc, fonts) : { serif: 'helvetica', sans: 'helvetica' };
    doc.setFont(fam2.serif, 'normal');
    // Plain white page — no border, no card.
    doc.setFillColor(...hex(PAPER));
    doc.rect(0, 0, PAGE_W, pageH, 'F');
    layout(doc, m, qrDataUrl, fam2);
    return doc.output('blob');
}
