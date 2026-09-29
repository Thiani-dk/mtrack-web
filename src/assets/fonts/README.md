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
- **IBM Plex Mono** — the sales receipt only (see `receiptFontData.ts`, kept
  in its own lazy chunk rather than `pdfFontData.ts` — the receipt no longer
  shares a layout with the other three document types at all, so it has no
  reason to share their font bundle either). A monospace face is the point:
  the receipt's columns (quantity × price, running totals) line up the way a
  real thermal-printer receipt's do, which a proportional face cannot fake.
  `@fontsource/ibm-plex-mono` ships static (non-variable) `glyf`-flavoured
  woff2 per weight, so no CFF conversion is needed here either. Weights 400
  and 700 (body and totals/business name), same unicode subset as the other
  two typefaces above.

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
6. IBM Plex Mono (`ibm-plex-mono-{regular,bold}.ttf` / `.woff2`): `npm pack
   @fontsource/ibm-plex-mono@5.2.5`; extract. No variable build exists for
   this family, so merge the `latin` + `latin-ext` static woff2 per weight
   (`fontTools.merge.Merger` — the `fonttools merge` CLI's own option parser
   rejects ordinary `-o file.ttf`-style flags in this version; the Python API
   sidesteps that) — each merged file is already `glyf`, so decompress
   straight from woff2 (`TTFont(path); font.flavor = None; font.save(...)`,
   no `otf2ttf` needed. `pyftsubset` each to the unicode set above, twice —
   once uncompressed for the PDF `.ttf`, once `flavor=woff2` for HTML/canvas.
7. base64 all files into `src/lib/pdfFontData.ts` (the three document types)
   and `src/lib/receiptFontData.ts` (the sales receipt) — read each file,
   chunk at 120 chars.

The committed `.ttf` / `.woff2` files here are the source of truth; the
generated `*FontData.ts` modules are what the app imports — lazily, so each
lands in its own chunk fetched only the first time that document type is
exported.

The interactive chat card (`ChatReceiptVisual`) instead uses
`@fontsource-variable/source-serif-4`, imported from `src/index.css` as the
`--font-serif` token, the same way Geist is wired for `--font-sans`.
