# Regenerating src/lib/pdfFontData.ts

The exported documents embed their own fonts so a downloaded PDF/HTML renders
in the real typefaces with no network. jsPDF 4.x parses `glyf` TrueType only.

## Typefaces

- **Source Serif 4** — the editorial serif. Carries the wordmark, the title,
  the section headers, the body and every monetary figure. `@fontsource`'s
  builds are already `glyf`-flavoured, so no CFF->quadratic conversion is
  needed. Subset here to Latin + Latin-1 + Latin Extended-A + common
  punctuation, weights 400 and 600.
- **Geist** — kept only for the small tracked-caps micro-labels, where a sans
  reads cleaner at 6-7pt. `@fontsource/geist-sans` ships as CFF/PostScript
  OpenType, so `geist-regular.ttf` here was converted cubic->quadratic
  (`otf2ttf` / cu2qu). Weight 400 only (the serif carries every bold).

## Steps

1. `npm pack @fontsource/source-serif-4@5.2.5` and
   `npm pack @fontsource-variable/source-serif-4@5.2.5`; extract.
2. `pip install --break-system-packages fonttools brotli otf2ttf`.
3. Static PDF faces (`source-serif-4-{regular,semibold}.ttf`): `fonttools merge`
   the `latin` + `latin-ext` static woff2 for weights 400 / 600, then
   `pyftsubset` to the unicode set above, save uncompressed (`font.flavor =
   None`).
4. HTML face (`source-serif-4-variable-subset.woff2`): subset the
   `latin-wght-normal` variable woff2 to the same set, keep the `wght` axis,
   `font.flavor = "woff2"`.
5. Geist (`geist-regular.ttf`, `geist-variable-subset.woff2`): as before —
   subset the `@fontsource/geist-sans` 400 latin woff2, `otf2ttf` to glyf;
   subset the `@fontsource-variable/geist` woff2 for the HTML @font-face.
6. base64 all five files into `src/lib/pdfFontData.ts` (see the generator
   snippet in scratchpad, or inline: read each file, chunk at 120 chars).

The committed `.ttf` / `.woff2` files here are the source of truth;
`pdfFontData.ts` is generated from them and is what the app imports — lazily,
from `receiptGenerator`, so it lands in its own chunk fetched on first export.

The interactive chat card (`ChatReceiptVisual`) instead uses
`@fontsource-variable/source-serif-4`, imported from `src/index.css` as the
`--font-serif` token, the same way Geist is wired for `--font-sans`.
