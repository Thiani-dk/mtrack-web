# Regenerating src/lib/pdfFontData.ts

Geist ships from @fontsource as CFF/PostScript-outline OpenType (woff2). jsPDF
4.x parses `glyf` TrueType only. So:

1. `npm pack @fontsource/geist-sans@5.3.0` ; extract the 400 + 700 latin woff2.
2. `pip install --break-system-packages fonttools brotli otf2ttf` (dev machine).
3. fonttools: subset each to Latin + Latin Extended-A + common punctuation,
   save as sfnt/otf.
4. `otf2ttf` (cu2qu): convert the CFF outlines cubic->quadratic -> real
   TrueType (glyf). Result: src/assets/fonts/geist-{regular,bold}.ttf.
5. Subset the @fontsource-variable/geist variable woff2 to the same glyph set,
   keep the wght axis -> src/assets/fonts/geist-variable-subset.woff2 (for the
   HTML @font-face).
6. base64 all three into src/lib/pdfFontData.ts.

The committed .ttf / .woff2 files under src/assets/fonts/ are the source of
truth; pdfFontData.ts is generated from them and is what the app imports
(lazily, from receiptGenerator, so it lands in its own chunk).
