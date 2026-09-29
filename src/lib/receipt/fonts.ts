// Loads the receipt's own embedded IBM Plex Mono (see receiptFontData.ts and
// src/assets/fonts/README.md) into the page's font set — mirrors
// dayCard/fonts.ts exactly, one copy per document type because each lazily
// imports its own font-data module rather than sharing a chunk with fonts it
// does not use.

const MONO_FAMILY = 'IBM Plex Mono Receipt';

export const RECEIPT_FONT_FAMILY: Record<import('../documentPrimitives').FontFamily, string> = {
    mono: MONO_FAMILY,
    // The receipt's own layout never emits a 'serif' or 'sans' run — these
    // exist only so the shared FontFamily type (day card + receipt) can be
    // indexed generically by the shared canvas measurer / PNG backend / DOM
    // view without a cast.
    serif: MONO_FAMILY,
    sans: MONO_FAMILY,
};

function b64ToBuffer(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

let loaded: Promise<void> | null = null;

export function loadReceiptFonts(): Promise<void> {
    if (loaded) return loaded;
    loaded = (async () => {
        const { IBM_PLEX_MONO_REGULAR_WOFF2_B64, IBM_PLEX_MONO_BOLD_WOFF2_B64 } = await import('../receiptFontData');
        const regular = new FontFace(MONO_FAMILY, b64ToBuffer(IBM_PLEX_MONO_REGULAR_WOFF2_B64), { weight: '400' });
        const bold = new FontFace(MONO_FAMILY, b64ToBuffer(IBM_PLEX_MONO_BOLD_WOFF2_B64), { weight: '700' });
        const [loadedRegular, loadedBold] = await Promise.all([regular.load(), bold.load()]);
        document.fonts.add(loadedRegular);
        document.fonts.add(loadedBold);
    })();
    loaded.catch(() => { loaded = null; });
    return loaded;
}
