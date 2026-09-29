// Loads the same embedded variable fonts the PDF/HTML document path already
// ships (see pdfFontData.ts) into the page's font set, under the same family
// names its @font-face rule already uses in the HTML export — so the day
// card's canvas export and its in-app DOM preview both render in the real
// typefaces with no network fetch, and the DOM preview needs no plumbing of
// its own beyond an ordinary CSS font-family.
//
// Dynamically imported, matching receiptGenerator.ts's own lazy-chunk
// convention for this font data — the ~390KB payload should not land in the
// app's initial bundle for a screen most sessions never open.
//
// Fails loudly (the returned promise rejects) rather than silently drawing in
// a fallback face: a share card people compare against each other needs to
// look the same every time it is opened, not different depending on whether
// the embedded font happened to load.

const SERIF_FAMILY = 'Source Serif 4 Web';
const SANS_FAMILY = 'Geist Web';

export const DAY_CARD_FONT_FAMILY: Record<import('../documentPrimitives').FontFamily, string> = {
    serif: SERIF_FAMILY,
    sans: SANS_FAMILY,
    // The day card's own layout never emits a 'mono' run — this key exists
    // only so the shared FontFamily type (day card + receipt) can be indexed
    // generically by the shared canvas measurer / PNG backend without a cast.
    mono: SANS_FAMILY,
};

function b64ToBuffer(b64: string): ArrayBuffer {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}

let loaded: Promise<void> | null = null;

export function loadDayCardFonts(): Promise<void> {
    if (loaded) return loaded;
    loaded = (async () => {
        const { SOURCE_SERIF_VARIABLE_WOFF2_B64, GEIST_VARIABLE_WOFF2_B64 } = await import('../pdfFontData');
        const serifFace = new FontFace(SERIF_FAMILY, b64ToBuffer(SOURCE_SERIF_VARIABLE_WOFF2_B64), { weight: '200 900' });
        const sansFace = new FontFace(SANS_FAMILY, b64ToBuffer(GEIST_VARIABLE_WOFF2_B64), { weight: '100 900' });
        const [serif, sans] = await Promise.all([serifFace.load(), sansFace.load()]);
        document.fonts.add(serif);
        document.fonts.add(sans);
    })();
    loaded.catch(() => { loaded = null; });
    return loaded;
}
