import type { MerchantResult } from '../types';
import { categorise } from '../hints/merchantCatalog';

export type { MerchantResult };

const BUSINESS_SUFFIX_RE = /\b(LTD|PLC|ENTERPRISE|T\/A|LIMITED|CO|SHOP|STORE|MART)\b/i;

// Card merchant format: "Netflix.com>Los Gatos NL", "ANTHROPIC* CLAUDE SUB>+14152360599 US"
// Anchored on "on " (the standard "Card PAYMENT of X on MERCHANT>LOCATION" wording)
// so the merchant capture can't creep back and swallow the amount/preamble.
const CARD_RE =
    /\bon\s+([^\n>]{2,60})>([^\n]{1,50}?)(?=\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\s+\d{1,2}-[A-Za-z]{3,9}-\d{4}|\s+Avail(?:able)?\s*Bal|\s*$)/i;

function cleanMerchantName(raw: string): string {
    let name = raw.trim();
    // '*' is commonly used as a brand/sub-service separator in card statements
    name = name.replace(/\*/g, ' ');
    // Strip a trailing alphanumeric transaction ref blob (e.g. "P405C0A90E")
    name = name.replace(/\s+([A-Z0-9]{8,14})$/i, (full, token: string) =>
        /[A-Z]/i.test(token) && /[0-9]/.test(token) ? '' : full
    );
    name = name.replace(/\.com\b/i, '');
    name = name.replace(/\s{2,}/g, ' ').trim();
    if (name.length > 3 && name === name.toUpperCase() && /[A-Z]/.test(name)) {
        name = name
            .split(' ')
            .map(w => (w.length ? w[0] + w.slice(1).toLowerCase() : w))
            .join(' ');
    }
    return name;
}

export function extractMerchant(msg: string, recipient: string | null): MerchantResult | null {
    const cardMatch = CARD_RE.exec(msg);
    if (cardMatch) {
        const name = cleanMerchantName(cardMatch[1]);
        const location = cardMatch[2].trim().replace(/\s{2,}/g, ' ');
        return {
            name,
            category: categorise(name),
            isBusiness: true,
            location: location.length > 0 ? location : null,
        };
    }

    if (!recipient) return null;

    const category = categorise(recipient);
    const isBusiness = BUSINESS_SUFFIX_RE.test(recipient) || category !== null;

    if (!isBusiness) return null; // P2P — the recipient name IS the detail

    return { name: recipient, category, isBusiness: true, location: null };
}
