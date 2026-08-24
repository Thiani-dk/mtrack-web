import type { ChannelResult } from '../types';

export type { ChannelResult };

interface ProviderSignal {
    provider: string;
    tests: RegExp[];
}

// Optional hints only — never gatekeepers. A message that matches none of
// these still parses fully through the generic extractors, just tagged
// "Unknown".
// M-PESA GlobalPay virtual-card approval messages ("Dear Daniel, a
// transaction ... done at MERCHANT has been approved on your card ****1234")
// never contain the literal string "M-PESA" — only the account-management
// notices and the paired M-PESA SMS do — so they need their own signal.
const GLOBALPAY_RE = /M-?PESA\s+GlobalPay|Global\s+Payments|GlobalPay\s+Virtual/i;
const VIRTUAL_CARD_APPROVAL_RE = /done at[\s\S]*?has been approved on your card/i;

const PROVIDER_SIGNALS: ProviderSignal[] = [
    { provider: 'M-PESA', tests: [/M-PESA/i, /MPESA/i, /saf\.cx/i, /\*334#/, GLOBALPAY_RE, VIRTUAL_CARD_APPROVAL_RE] },
    { provider: 'Airtel Money', tests: [/Airtel Money/i, /\bAirtel\b/i] },
    { provider: 'T-Kash', tests: [/T-Kash/i, /\bTelkom\b/i] },
    { provider: 'Co-operative Bank', tests: [/Co-operative Bank/i, /Co-op Bank/i, /\+254703027000/] },
    { provider: 'Equity', tests: [/Equity Bank/i, /EazzyBanking/i, /Equitel/i] },
    { provider: 'KCB', tests: [/\bKCB\b/i, /Lipa na KCB/i] },
    { provider: 'Absa', tests: [/\bAbsa\b/i, /\bBarclays\b/i] },
    { provider: 'Standard Chartered', tests: [/Standard Chartered/i, /StanChart/i] },
    { provider: 'NCBA', tests: [/\bNCBA\b/i, /\bLOOP\b/] },
    { provider: 'Stanbic', tests: [/Stanbic/i] },
    { provider: 'DTB', tests: [/\bDTB\b/i, /Diamond Trust/i] },
    { provider: 'I&M', tests: [/\bI&M\b/i] },
    { provider: 'Family Bank', tests: [/Family Bank/i] },
    { provider: 'Sidian', tests: [/\bSidian\b/i] },
    { provider: 'Gulf African', tests: [/Gulf African/i] },
];

const CARD_MERCHANT_RE = /[^\s>]{2,}>[A-Za-z]/;

export function extractChannel(msg: string): ChannelResult {
    let provider = 'Unknown';
    let providerConfidence = 0;
    for (const sig of PROVIDER_SIGNALS) {
        if (sig.tests.some(re => re.test(msg))) {
            provider = sig.provider;
            providerConfidence = 90;
            break;
        }
    }

    let method = 'transfer';
    if (GLOBALPAY_RE.test(msg) || VIRTUAL_CARD_APPROVAL_RE.test(msg)) {
        method = 'virtual_card';
    } else if (/card\s*payment/i.test(msg) || /card ending/i.test(msg) || CARD_MERCHANT_RE.test(msg)) {
        method = 'card';
    } else if (/for account/i.test(msg)) {
        method = 'paybill';
    } else if (/paid to/i.test(msg)) {
        method = 'till';
    } else if (/\bairtime\b/i.test(msg)) {
        method = 'airtime';
    } else if (/data bundles/i.test(msg) || /data weekly/i.test(msg)) {
        method = 'data';
    } else if (/withdraw/i.test(msg) || /\bcash to\b/i.test(msg)) {
        method = 'cash';
    } else if (/m-shwari/i.test(msg) || /\bziidi\b/i.test(msg) || /kcb m-pesa/i.test(msg)) {
        method = 'savings';
    } else if (/received/i.test(msg) && /\bfrom\b/i.test(msg)) {
        method = 'p2p_in';
    } else if (/sent to/i.test(msg)) {
        method = 'p2p';
    }

    const confidence = Math.max(providerConfidence, method !== 'transfer' ? 60 : 30);
    return { provider, method, confidence };
}

const CARD_LAST4_RE = /card\s+\*{2,4}(\d{3,4})/i;

export function extractCardLast4(msg: string): string | null {
    const m = msg.match(CARD_LAST4_RE);
    return m ? m[1] : null;
}
