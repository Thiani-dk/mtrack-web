// Pre-pass classifier — runs before any field extraction. Service/security
// notices about the M-PESA GlobalPay virtual card (account state changes,
// PIN alerts) share vocabulary with real transaction messages closely enough
// that the field extractors used to misparse or reject them as noise. This
// sorts messages into buckets first so only genuine transactions ever reach
// the extractor pipeline.

import { extractAmountMatches } from './extractors/amount';
import { normalizeForKeywords } from './fuzzy';
import { SWAHILI_VERBS } from './swahili';

export type MessageClass = 'transaction' | 'service_notice' | 'security_alert' | 'promotional' | 'unknown';

// Checked first and takes priority over the other buckets: a transaction
// confirmation (e.g. a card-approval message) can legitimately contain
// phrasing that also matches a security-alert signal ("If not yours,
// contact us"), but it's still a transaction.
const CURRENCY_RE = /(Ksh\.?|KES|USD|EUR|GBP|TZS|UGX|RWF|\$|£|€)\s*\.?\s*[\d,]+(?:\.\d{1,2})?/i;

// The spec's base verb list (sent/paid/received/withdraw/approved/done at/
// charge) misses several verbs the pre-existing extractor pipeline already
// relies on ("Card PAYMENT of...", "You bought...", "...has been credited
// with...") — broadened here so genuine transaction messages that predate
// this classifier keep reaching the extractors.
const TRANSACTION_VERB_RE =
    new RegExp(
        String.raw`\b(?:sent|paid|payment|received|withdraw|approved|charge(?:d)?|bought|purchased`
        + String.raw`|credited|debited|deposited|transferred|refund|reversal`
        + String.raw`|${SWAHILI_VERBS.join('|')})\b|\bdone at\b`,
        'i',
    );

// Checked BEFORE the currency+verb test: these carry transaction-verb-like
// wording ("Interest charged", "credited") but are notices, not payments.
const NON_TRANSACTION_OVERRIDES: RegExp[] = [
    // A standalone Fuliza / overdraft facility notice — no payment happened,
    // it just reports the outstanding overdraft. A real payment that merely
    // *drew on* Fuliza has "sent to"/"paid to" and is not matched here.
    /Confirmed\.?\s*Fuliza\s+M-?PESA\s+amount\s+is/i,
    /Total\s+Fuliza\s+M-?PESA\s+outstanding\s+amount\s+is/i,
];

const SERVICE_NOTICE_PATTERNS: RegExp[] = [
    /has been unsuspended/i,
    /has been suspended/i,
    /you have viewed your card details/i,
    /has been created successfully/i,
    /successfully registered/i,
    /you can only apply for up to/i,
    /keep them secure/i,
    /to unsuspend/i,
    /confirming successful unsuspension/i,
    // Balance enquiry / non-transaction M-PESA messages that still carry an
    // amount and a date.
    /Your\s+M-?PESA\s+balance\s+(?:was|is)\b/i,
    /to your\s+M-?PESA\s+contacts\b/i,
    /M-?PESA\s+statement\s+for\s+.+\s+is\s+ready/i,
    /statement\s+is\s+ready/i,
];

const SECURITY_ALERT_PATTERNS: RegExp[] = [
    /if not yours,? contact us/i,
    /exceeding number of pin entries/i,
    /keep your pin secure/i,
];

// The verb gate, with a bounded second look for a misspelling.
//
// A fixed-vocabulary gate like this has already cost this project one
// confirmed miss, and an exact-substring requirement means one wrong letter
// anywhere in a keyword removes the whole message's ability to be recognised —
// not just that word. "boought" must read as "bought". The fuzzy pass only
// runs once the exact one has failed, so a message containing a correctly
// spelled verb never has anything in it reinterpreted. See fuzzy.ts.
export function hasTransactionVerb(msg: string): boolean {
    if (TRANSACTION_VERB_RE.test(msg)) return true;
    return TRANSACTION_VERB_RE.test(normalizeForKeywords(msg));
}

export function classifyMessage(msg: string): MessageClass {
    if (NON_TRANSACTION_OVERRIDES.some(re => re.test(msg))) return 'service_notice';
    if (CURRENCY_RE.test(msg) && hasTransactionVerb(msg)) return 'transaction';
    if (SERVICE_NOTICE_PATTERNS.some(re => re.test(msg))) return 'service_notice';
    if (SECURITY_ALERT_PATTERNS.some(re => re.test(msg))) return 'security_alert';
    // Typed input, where nobody writes "Ksh": "i bought airtime worth 30" is a
    // transaction description even though CURRENCY_RE finds nothing in it. Last
    // of all, and only over messages already ruled out as notices and alerts,
    // so this can only ever promote what used to fall through as 'unknown'.
    if (hasTransactionVerb(msg) && extractAmountMatches(msg, { allowBare: true }).length > 0) {
        return 'transaction';
    }
    return 'unknown';
}
