// Optional confidence boosters only — never gatekeepers. A message with no
// matching hint must still parse fully through the generic extractors.

interface ProviderHintSignature {
    provider: string;
    test: RegExp;
}

const HINT_SIGNATURES: ProviderHintSignature[] = [
    // M-PESA always leads with its transaction code
    { provider: 'M-PESA', test: /^[A-Z0-9]{10}\s+Confirmed/i },
    // Co-op card/credit alerts always name the bank explicitly
    { provider: 'Co-operative Bank', test: /Co-operative Bank|Co-op Bank/i },
];

export function applyProviderHint(msg: string, provider: string): number {
    for (const sig of HINT_SIGNATURES) {
        if (sig.provider === provider && sig.test.test(msg)) return 10;
    }
    return 0;
}
