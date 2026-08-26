// Cleaning, splitting, and dedup — everything that happens to raw pasted text
// before any field extractor sees it.

// ── XML SMS-backup decoding ─────────────────────────────────────────────────
// "SMS Backup & Restore" exports look like <sms ... body="..." .../>. Each
// body attribute is one complete message — no further block splitting needed.

function extractXmlBodies(text: string): string[] | null {
    if (!(text.startsWith('<') && text.includes('body='))) return null;
    const bodies: string[] = [];
    const bodyRegex = /body="((?:[^"\\]|\\.)*)"/g;
    let match: RegExpExecArray | null;
    while ((match = bodyRegex.exec(text)) !== null) {
        const decoded = match[1]
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#10;/g, '\n')
            .replace(/&apos;/g, "'");
        bodies.push(decoded);
    }
    return bodies.length > 0 ? bodies : null;
}

// ── WhatsApp export prefixes ────────────────────────────────────────────────
// "[21/08, 21:52] Danny: UHL7A3OZTN Confirmed..." — strip the bracketed
// timestamp + contact name so the extractors see raw SMS content.

const WHATSAPP_PREFIX_RE =
    /^\[\d{1,2}\/\d{1,2}(?:\/\d{2,4})?,?\s*\d{1,2}:\d{2}(?::\d{2})?\s*(?:[AP]M)?\]\s*[^:]{1,40}:\s*/gm;

// iOS exports always include seconds and sometimes a narrow no-break space
// before AM/PM instead of a regular one.
const WHATSAPP_IOS_PREFIX_RE =
    /^\[\d{1,2}\/\d{1,2}\/\d{2,4},\s*\d{1,2}:\d{2}:\d{2}[ \s]?(?:[AP]M)?\]\s*[^:]{1,40}:\s*/gm;

export function stripWhatsAppPrefixes(text: string): string {
    return text
        .replace(WHATSAPP_PREFIX_RE, '')
        .replace(WHATSAPP_IOS_PREFIX_RE, '');
}

// ── Forwarded email chrome ──────────────────────────────────────────────────

const EMAIL_HEADER_RE = /^(From|To|Cc|Bcc|Subject|Sent|Date):\s*/i;

export function stripEmailChrome(text: string): string {
    // Drop a trailing signature block (a standalone "--" line and everything after)
    let out = text.replace(/\n--\s*\n[\s\S]*$/, '');

    out = out
        .split('\n')
        .filter(line => !EMAIL_HEADER_RE.test(line.trim()))
        .map(line => line.replace(/^>+\s?/, ''))
        .join('\n');

    // Strip any HTML tags that survived a rich-text paste
    out = out.replace(/<[^>]+>/g, '');

    return out;
}

// ── Noise lines ──────────────────────────────────────────────────────────────
// These trailer sentences carry no transaction data. They usually ride along
// inside the same SMS as the real confirmation, so we strip the sentence
// containing the phrase rather than only whole matching lines.

const NOISE_PATTERNS: RegExp[] = [
    /never share your (?:card|pin|m-?pesa pin) details with anyone/i,
    /download my oneapp on https?:\/\/\S+/i,
    /separate personal and business funds through pochi la biashara/i,
    /you can now access m-pesa via \*334#/i,
    /enquiries\s*\+254\S*/i,
    /amount you can transact within the day is[^.]{0,80}/i,
    /we are you!?/i,
    /this is an automated message/i,
    /do not reply to this/i,
    /terms and conditions apply/i,
    /t&cs apply/i,
];

// Bounded, not unbounded (*), on both sides of the phrase: an unbounded
// [^.\n]* wrapper has nothing to anchor its backtracking when a long paste
// has no nearby period/newline (a rambling forwarded chat, adversarial
// input) — the engine tries every possible span length at every position,
// which is quadratic in the input length. 300 chars comfortably covers any
// real SMS trailer sentence while keeping the worst-case backtrack bounded.
const NOISE_CONTEXT_SPAN = 300;

export function stripNoiseLines(text: string): string {
    let out = text;
    for (const re of NOISE_PATTERNS) {
        out = out.replace(
            new RegExp(`[^.\\n]{0,${NOISE_CONTEXT_SPAN}}${re.source}[^.\\n]{0,${NOISE_CONTEXT_SPAN}}\\.?`, 'gi'),
            ''
        );
    }
    return out.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
}

// ── Block splitting ──────────────────────────────────────────────────────────
// Split on blank lines OR a line that looks like the start of a new message
// (a code-like opener, "Dear ", "Ref:", "Hello "/"Hi ", or a date-led alert).
// Never split mid-message: a line only starts a new block if we've already
// accumulated content for the current one.

function isCodeOpener(line: string): boolean {
    const m = line.match(/^([A-Z0-9]{8,12})\b/);
    if (!m) return false;
    const token = m[1];
    return /[A-Z]/.test(token) && /[0-9]/.test(token);
}

function isMessageOpener(line: string): boolean {
    const trimmed = line.trimStart();
    if (trimmed.length === 0) return false;
    if (isCodeOpener(trimmed)) return true;
    if (/^(Dear|Hello|Hi)\s/i.test(trimmed)) return true;
    if (/^Ref:/i.test(trimmed)) return true;
    if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/.test(trimmed)) return true;
    return false;
}

export function splitIntoBlocks(text: string): string[] {
    const blocks: string[] = [];
    const paragraphs = text.split(/\n{2,}/);

    for (const para of paragraphs) {
        const lines = para.split('\n');
        let current: string[] = [];
        for (const line of lines) {
            if (current.length > 0 && isMessageOpener(line)) {
                blocks.push(current.join('\n').trim());
                current = [line];
            } else {
                current.push(line);
            }
        }
        if (current.length > 0) blocks.push(current.join('\n').trim());
    }

    return blocks.map(b => b.trim()).filter(Boolean);
}

// ── Orchestration ────────────────────────────────────────────────────────────

export function preprocessToBlocks(raw: string): string[] {
    const trimmed = raw.trim();
    if (!trimmed) return [];

    const xmlBodies = extractXmlBodies(trimmed);
    if (xmlBodies) {
        return xmlBodies
            .map(stripNoiseLines)
            .map(b => b.trim())
            .filter(Boolean);
    }

    let cleaned = stripWhatsAppPrefixes(trimmed);
    cleaned = stripEmailChrome(cleaned);
    cleaned = stripNoiseLines(cleaned);
    return splitIntoBlocks(cleaned);
}

// ── Dedup ─────────────────────────────────────────────────────────────────────
// (code + amount + date-to-minute), keeping the first occurrence.

export function dedupeTransactions<T extends { transactionCode: string; amount: number; date: Date }>(
    items: T[]
): { unique: T[]; duplicatesRemoved: number; removed: T[] } {
    const seen = new Set<string>();
    const unique: T[] = [];
    const removed: T[] = [];

    for (const item of items) {
        const minuteKey = Math.floor(item.date.getTime() / 60000);
        const key = `${item.transactionCode}|${item.amount}|${minuteKey}`;
        if (seen.has(key)) {
            removed.push(item);
            continue;
        }
        seen.add(key);
        unique.push(item);
    }

    return { unique, duplicatesRemoved: removed.length, removed };
}
