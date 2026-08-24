interface CatalogEntry {
    category: string;
    keywords: string[];
}

export const MERCHANT_CATALOG: CatalogEntry[] = [
    { category: 'Streaming & Subscriptions', keywords: ['netflix', 'spotify', 'showmax', 'youtube', 'apple', 'anthropic', 'openai', 'adobe', 'microsoft', 'google', 'dropbox', 'notion', 'canva'] },
    { category: 'Gaming', keywords: ['roblox', 'steam', 'playstation', 'xbox', 'nintendo', 'epic games'] },
    { category: 'Supermarket', keywords: ['naivas', 'carrefour', 'quickmart', 'chandarana', 'tuskys', 'cleanshelf', 'magunas', 'western mart'] },
    { category: 'Restaurant & Food', keywords: ['galitos', 'java', 'kfc', 'pizza', 'burger', 'cafe', 'coffee', 'urban fries', 'creamy', 'lickher', 'chicken', 'kitchen', 'grill', 'bar', 'wines', 'spirits'] },
    { category: 'Transport & Fuel', keywords: ['uber', 'bolt', 'little', 'shell', 'total', 'rubis', 'ola', 'petrol', 'fuel', 'matatu', 'sacco', 'auto', 'garage', 'tyres'] },
    { category: 'Utilities', keywords: ['kplc', 'kenya power', 'nairobi water', 'zuku', 'safaricom home', 'faiba', 'startimes', 'dstv', 'gotv'] },
    { category: 'Telecoms', keywords: ['airtime', 'data bundles', 'safaricom postpaid', 'bundles'] },
    { category: 'Health', keywords: ['hospital', 'clinic', 'pharmacy', 'chemist', 'medical', 'dental', 'optical'] },
    { category: 'Education', keywords: ['school', 'college', 'university', 'academy', 'fees', 'tuition'] },
    { category: 'Banking & Transfers', keywords: ['bank money transfer', 'lipa na', 'loan', 'sacco', 'savings', 'ziidi', 'm-shwari', 'kcb m-pesa'] },
    { category: 'Retail', keywords: ['shop', 'store', 'mart', 'boutique', 'hardware', 'electronics'] },
    { category: 'Government', keywords: ['kra', 'ntsa', 'nhif', 'nssf', 'huduma', 'county'] },
];

export function categorise(name: string): string | null {
    const lower = name.toLowerCase();
    for (const entry of MERCHANT_CATALOG) {
        if (entry.keywords.some(kw => lower.includes(kw))) return entry.category;
    }
    return null;
}
