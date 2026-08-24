// Pre-pass classifier — runs before any field extraction. Service/security
// notices about the M-PESA GlobalPay virtual card (account state changes,
// PIN alerts) share vocabulary with real transaction messages closely enough
// that the field extractors used to misparse or reject them as noise. This
// sorts messages into buckets first so only genuine transactions ever reach
// the extractor pipeline.

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
    /\b(?:sent|paid|payment|received|withdraw|approved|charge(?:d)?|bought|purchased|credited|debited|deposited|transferred|refund|reversal)\b|\bdone at\b/i;

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
];

const SECURITY_ALERT_PATTERNS: RegExp[] = [
    /if not yours,? contact us/i,
    /exceeding number of pin entries/i,
    /keep your pin secure/i,
];

export function classifyMessage(msg: string): MessageClass {
    if (CURRENCY_RE.test(msg) && TRANSACTION_VERB_RE.test(msg)) return 'transaction';
    if (SERVICE_NOTICE_PATTERNS.some(re => re.test(msg))) return 'service_notice';
    if (SECURITY_ALERT_PATTERNS.some(re => re.test(msg))) return 'security_alert';
    return 'unknown';
}
