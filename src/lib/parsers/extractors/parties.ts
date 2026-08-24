import type { PartiesResult } from '../types';

export type { PartiesResult };

// Recipient patterns (money going out). Tried in order; the first with an
// account also captures it, saving a second pass.
const RECIPIENT_PATTERNS: RegExp[] = [
    /to\s+(.+?)\s+for account\s+(\S+)/i,
    /(?:sent|paid|transferred)\s+to\s+(.+?)(?=\s+(?:for account|on\s+\d|\d{1,2}\/|\.|$))/i,
    /Give\s+Ksh[\d,.]+\s+cash\s+to\s+(.+?)(?=\s+(?:on\s+\d|New|$))/i,
    /Withdraw.+?from\s+(.+?)(?=\s+(?:on\s+\d|New|$))/i,
];

// Sender pattern (money coming in)
const SENDER_PATTERN = /(?:received|credited with).+?from\s+(.+?)(?=\s+(?:on\s+\d|\d{1,2}\/|at\s+\d|\.|$))/i;

const ACCOUNT_PATTERN = /for account\s+(\S+?)(?=\s+on|\s*\.|\s*$)/i;

const PRESERVE_SUFFIXES = new Set(['LTD', 'PLC', 'T/A', 'ENTERPRISE', 'LIMITED', 'CO']);

function titleCaseKeepingSuffixes(name: string): string {
    return name
        .split(' ')
        .map(word => {
            if (word.length === 0) return word;
            const bare = word.replace(/[^A-Z/]/g, '');
            if (PRESERVE_SUFFIXES.has(bare)) return word;
            return word[0] + word.slice(1).toLowerCase();
        })
        .join(' ');
}

function cleanName(raw: string): string {
    let name = raw;
    // Trailing Kenyan phone numbers — plain and masked
    name = name.replace(/\s*\+?(?:254|0)[17]\d{8}\b/g, '');
    name = name.replace(/\s*0\d{3}\*{2,3}\d{3}\b/g, '');
    // Coop-style "NAME-0707322160" phone suffix
    name = name.replace(/-\d{9,10}\b/g, '');
    // Collapse whitespace
    name = name.replace(/\s{2,}/g, ' ').trim();
    // Trailing punctuation
    name = name.replace(/[.,]+$/g, '').trim();
    // Title Case if ALL CAPS, preserving business suffixes
    if (name.length > 3 && name === name.toUpperCase() && /[A-Z]/.test(name)) {
        name = titleCaseKeepingSuffixes(name);
    }
    if (name.length > 60) name = name.slice(0, 60).trim();
    return name;
}

export function extractParties(msg: string): PartiesResult {
    let recipient: string | null = null;
    let account: string | null = null;

    for (const re of RECIPIENT_PATTERNS) {
        const m = msg.match(re);
        if (m) {
            recipient = cleanName(m[1]);
            if (m[2]) account = m[2].replace(/\.$/, '');
            break;
        }
    }

    if (!account) {
        const am = msg.match(ACCOUNT_PATTERN);
        if (am) account = am[1].replace(/\.$/, '');
    }

    let sender: string | null = null;
    const sm = msg.match(SENDER_PATTERN);
    if (sm) sender = cleanName(sm[1]);

    return { sender, recipient, account };
}
