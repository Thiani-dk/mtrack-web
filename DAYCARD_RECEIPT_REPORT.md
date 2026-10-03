# The Active Mode day card, cash, and the sales receipt: final report

Seven phases: an audit, the `daily_sales` document type and its migration,
cash as a first-class capture method, the day card itself, the sales receipt
rebuilt as a thermal-receipt-style document, onboarding/README updates, and a
three-round visual critique loop. This report covers all seven.

---

## 1. Scoreboard, before and after

| | Before | After |
|---|---|---|
| Test files | 31 | 44 |
| Unit/integration tests | — | 2,393, all passing |
| e2e scripts | 8 | 11 (+`cash`, `dayCard`, `receipt`) |
| `MTRACK_DB_VERSION` | 6 | 7 |
| Document types | 4 (Active Mode reused `expense_summary`) | 5 (`daily_sales` is its own type) |
| Active Mode capture methods | Paste only | Paste, or Cash (bucket → amount, "Same again" in one tap) |
| What Finish produces | An `expense_summary`-shaped document with a bucket-breakdown section | A `daily_sales` document, landing on its own shareable day card |
| `point_of_sale` rendering | The shared editorial-serif layout (`documentLayout.ts`), same as the other three document types | Its own primitives-based thermal-receipt layout: IBM Plex Mono, torn edges, a QR carrying the receipt's own facts, amount-in-words, reconciliation |
| Receipt reference numbers | `generateReceiptRef()`, regenerated from the clock on every render — collided within the same minute, disagreed with itself a minute later | A stable `receiptNumber`, generated once per document, migrated onto every existing record |

Every phase gates on the same four checks before its commit: `npm run build`,
`npm run lint`, `npm test`, and the relevant slice of `npm run test:e2e` (the
full suite, re-run at the end of Phase 6, passes clean: `journey`, `viewport`,
`buckets`, `cash`, `dayCard`, `receipt`, `capture`, `wakeLock`, `paste`,
`onboarding`, `demo`, `conversation`).

---

## 2. Design choices

### 2.1 One shared "positioned primitives" architecture, not two

The spec asked for one layout that produces positioned primitives (text runs
and rectangles), drawn by separate backends. Built once
(`src/lib/documentPrimitives.ts`) and used by both the day card and the
receipt rather than each document type inventing its own:

- **`TextRun`, `Rect`** — the original two, generic enough for both documents.
- **`ZigzagEdge`** (`buildTornEdge`) — added for the receipt's torn paper
  edge. The layout computes the actual tooth polygon once; canvas fills it,
  the DOM backend clips a `<div>` to the same points via `clip-path`, jsPDF
  fills the same points via `doc.lines()`. All three draw the identical
  shape because none of them decide the geometry themselves.
- **`ImagePrimitive`** — added for the receipt's QR code (a pre-generated
  data URL; generating it is an async side effect, kept out of the otherwise
  synchronous, pure layout function — the same pattern already used for font
  loading before the day card's own layout runs).
- **`FontFamily`** widened from `'serif' | 'sans'` to include `'mono'`.

Text-fitting logic (`fitSize`, `wrapLines`, `truncateToWidth`) and the canvas
draw loop (`primitiveCanvasRenderer.ts`) and the DOM view (`PrimitivesView
.tsx`) were extracted out of the day card's own files into shared modules
once the receipt needed the identical logic a second time, rather than
forking a copy. A new PDF walker (`primitiveToPdf.ts`) was added as a fourth
backend, used only by the receipt (the day card has no PDF export — its
secondary PDF, the sales log, deliberately reuses the *existing*
`documentLayout.ts` pipeline instead; see §2.3).

### 2.2 The day card

Dark, monochrome, serif hero figure — as specified. Adaptive rules (§3.4 of
the brief), each with its own fixture in `dayCard/model.test.ts`:

- A single bucket collapses to one sentence ("All in Combo sales.") instead
  of a one-row chart.
- More than four buckets show the top four plus one combined "N other
  buckets" row; Unsorted is always listed separately, last, never folded into
  "other."
- 30% or more of counted sales missing a clock time swaps the third tile from
  Peak hour to Biggest sale — verified in Round 1 of the critique log against
  a real fixture (three lump sums with counts, no time, against one dated
  sale), not just the estimator-driven unit test.
- A lump sum with no stated count contributes its money to the hero (every
  shilling is real) but not to the sale count or the average; the card says
  so ("Average excludes cash entered as a lump sum.") rather than silently
  under- or over-stating the day.
- Private notes (Unsorted leftovers, a balance mismatch, missing times,
  duplicates) render above the preview and are never part of the exported
  image — proven by a dedicated test (`private notes never reach the
  exported primitives`) that would fail the moment someone "helpfully" added
  them to the primitive list.

Sharing extends the existing three-tier `share()` (native file share → native
text share → clipboard) with a PNG file, plus a plain "Save image" download.
The secondary sales-log PDF reuses the *existing* four-document-type pipeline
rather than a fifth renderer: each transaction's `merchant` field is
overridden to `"<bucket> · <time>"` before rendering, which is enough on its
own to keep customer names out, because `getRecipientShort()` already prefers
`merchant` over `recipient` for this transaction subtype. Confirmed on an
actual rasterised page in the critique log, not just asserted in a unit test.

### 2.3 The sales receipt

The receipt no longer looks like the other three document types. It is
narrow (576px design width — 80mm at 203dpi, a real thermal roll's own raster
width), monospace throughout (IBM Plex Mono), with a torn top and bottom
edge, and prints at true 80mm size when exported as a PDF.

- **Amount in words** (`receipt/amountInWords.ts`) — a from-scratch,
  currency-generic number-to-English-words converter ("ONE THOUSAND TWO
  HUNDRED AND FIFTY SHILLINGS AND FIFTY CENTS ONLY"), 14 tests covering
  teens, hundreds, thousands, millions, singular shilling/cent, and rounding.
- **A QR code carrying its own facts** (`MTRACK-RECEIPT-V1|<ref>|<business>|
  <total>|<currency>|<date>`, pipe-delimited) rather than the static
  marketing URL every other document type's QR points at. The one document
  actually handed to someone else is the one that needs to prove its own
  numbers with no network at all — matching this app's hard offline
  constraint literally, not just in spirit.
- **Reconciliation.** When the itemised lines don't sum to what was actually
  received, the receipt asks once — was that a tip, a discount, or would you
  rather leave it unexplained — and the answer (`doc.tip` / `doc.discount`)
  is carried on the document forever. Declining the prompt doesn't hide the
  gap: it prints as "Unexplained difference," honestly, every time, until
  answered.
- **`servedBy`** — a new, optional, point-of-sale-only field, editable after
  the fact (tap the field, same pattern as the day card's stall name),
  because who served a sale is operational metadata, not a fact the
  financial reconciliation depends on.
- **Provenance** — one plain sentence, computed from the transaction's own
  `dataSource` and `method`: "Verified from an M-Pesa payment message,"
  "Cash, entered by the seller," "Entered by the seller, not from a payment
  message," or an honest "a mix" when a receipt spans more than one kind.

**"Save as web page" is a deliberate simplification.** Rather than build a
third from-scratch renderer (positioned `<div>`s serialised to an HTML
string, on top of the canvas and DOM backends the receipt already has), the
HTML export wraps the exact same PNG the canvas backend produces in a
minimal, valid, offline-viewable page. The visible result is identical
either way; this removes a third place the renderers could ever quietly
disagree, at the cost of a downloaded "web page" being an image rather than
selectable text. Documented here rather than silently — it is a real,
intentional trade of one property (text selection in the HTML file) for
another (one less rendering path to keep in sync), not an oversight.

### 2.4 Provenance and locking, scoped down honestly

The brief asked for "provenance/locking." What shipped: every receipt states
its own provenance in one sentence (above), and there is no line-item editing
UI anywhere in the new receipt screen at all — `servedBy`, the business name
and the contact are the only fields that can change after a receipt is
approved, and none of them are financial facts. A separate `locked: boolean`
flag was considered and not built, because there is nothing on this screen a
lock would need to prevent that isn't already prevented by the screen simply
not offering it. If a future capture path ever adds transaction-level editing
to an approved receipt, a real lock (rather than "no UI for it yet") would
become necessary then.

---

## 3. Dependency justifications

**No new runtime dependency was added.** Three things that might look like
one:

- **IBM Plex Mono.** Sourced the same way Source Serif 4 and Geist already
  are: `npm pack @fontsource/ibm-plex-mono`, subset with `pyftsubset` to the
  same Latin + Latin-1 + Latin Extended-A + punctuation range as the other
  two typefaces, base64-embedded into a new lazily-loaded module
  (`receiptFontData.ts`). `@fontsource/ibm-plex-mono` itself was never added
  to `package.json` — the *static* `@fontsource/source-serif-4` and
  `@fontsource/geist-sans` packages this pipeline has always used for
  one-time font generation aren't in `package.json` either; only the
  *variable* builds used by the live interactive chat card are runtime
  dependencies. Fully documented, with the exact commands, in
  `src/assets/fonts/README.md`.
- **The `qrcode` package** (already a dependency, already used for every
  other document type's marketing-link QR) is reused for the receipt's own
  facts-payload QR — no new package, just a new call site.
- **`papaparse`** (Phase 2, cash CSV export) shipped with a hand-written
  local `.d.ts` rather than `@types/papaparse`, which doesn't exist on npm
  for the installed version; documented in `src/types/papaparse.d.ts`.

---

## 4. Decision queue

Nothing new was added to `DECISIONS.md` in Phases 3–6. `D7` (written during
Phase 2) already covers the one genuinely subjective call in this whole
pass — the three candidate interaction designs for cash entry, and why the
overlay pattern won over an inline toggle or a bucket long-press, with
screenshots of all three. Everything built in Phases 3–6 was either
explicitly authorised by the brief (the day card, the receipt's redesign,
`receiptNumber`, `servedBy`, `tip`/`discount`) or an ordinary implementation
call with no owner-specific voice at stake (colour values, exact pixel
paddings, button copy).

---

## 5. Deviations from the spec, and why

- **The conversational engine was not extended with a dedicated "cash sale"
  recognizer for `point_of_sale`.** The brief's "new capture paths
  (message/cash/typed-M-Pesa)" line was interpreted, after investigation, as
  asking the shared intent/slot-filling subsystem (`conversationalCapture
  .ts`, `openingIntent.ts`, `conversation/enrichment.ts`) to recognise a
  typed cash sale the same way Active Mode's own `captureFromTyped` already
  does. That subsystem underpins every document type's chat conversation and
  has had many prior phases of careful, dedicated work go into it; extending
  it safely would be its own multi-phase pass, not a corner of this one. The
  `method` field and `isCashSale()` Phase 2 already built are there for it —
  point_of_sale receipts can already represent a cash sale correctly (the
  receipt's own provenance line and reconciliation already handle it, as
  shown in the critique log's fixtures); what's missing is only the chat
  engine's own recognition of "cash" as a spoken payment method for this one
  document type. Flagged plainly rather than silently narrowed.
- **"Save as web page" wraps a PNG rather than re-implementing positioned
  HTML a third time** — see §2.3.
- **A full `locked` flag was not built** — see §2.4.
- **`receiptNumber` was added to the shared `TrackedDocument` schema for all
  four other document types too**, not only `point_of_sale` — a strictly
  additive, low-risk migration (v7), because a stable, collision-free
  reference is simply better than the alternative for every document type,
  and the alternative (touching only `point_of_sale`'s own construction
  path) would have meant a second, parallel reference-numbering scheme living
  alongside the old one. The other three document types' own renderers were
  deliberately left untouched and still call the old `generateReceiptRef()`
  internally — exactly the scope the Phase 0 audit called for ("out of this
  pass's scope to change").

---

## 6. Honest assessment

**What is solid:** the positioned-primitives architecture, and everything
built on it, is thoroughly tested at three levels — pure arithmetic/adaptive
logic (unit tests against real fixtures), geometry (bounds, overlap, minimum
text size, determinism, against a deterministic estimator so the tests don't
depend on which real font happens to be installed), and now, after Phase 6,
a real look at the actual rendered pixels across a representative spread of
edge cases in both documents. The cash flow, the day card, and the receipt
are each covered end to end by a dedicated e2e script that drives the real
UI and reads the real IndexedDB record, not just the screen.

**What a real bug this pass found and fixed, that had nothing to do with the
day card or the receipt specifically:** `OverlayStackProvider`'s `register`/
`unregister` functions were plain closures, recreated on every render, which
put *any* open `StackedPanel` anywhere in the app into a silent infinite
re-render loop the moment it opened. It never broke functionality outright —
React's own update-depth guard let the last write stick before aborting
further updates — so it only ever showed up as console warning spam, and the
existing e2e suite (which checked `pageerror` but not `console.error`) never
caught it. Found by watching the console during ordinary feature testing of
the cash overlay, well before the formal Phase 6 critique loop. Fixed with a
two-line `useCallback`, and `cash.e2e.mjs` / `dayCard.e2e.mjs` /
`receipt.e2e.mjs` now all assert a clean console, so a regression here would
be caught immediately rather than needing to be rediscovered by hand.

**What was not, and honestly could not be, fully exercised:** a genuine
reconciliation gap (items and the amount received actually disagreeing) is
hard to produce through the conversational engine alone, because correcting
a transaction's amount rescales its line items to match rather than leaving
them stale — a sensible existing behaviour, not a bug, but one that meant
the discount fixture in the critique log needed one documented, one-off
IndexedDB patch to produce for a visual check. The underlying logic has a
full, passing unit suite (`receipt/model.test.ts`'s match/tip/discount/
unexplained cases); only the *visual sighting* of that one path leaned on a
synthetic fixture rather than an entirely organic one.

**What is deliberately out of scope, stated plainly rather than quietly
dropped:** the conversational engine's own recognition of a typed cash sale
for `point_of_sale` (§5). Everything else in the original brief — the cash
capture flow, the day card in its exact specified visual format, the sales
receipt's redesign with IBM Plex Mono, torn edges, the QR facts payload,
amount-in-words, reconciliation and provenance — shipped, tested, and was
looked at as real pixels before being called done.
