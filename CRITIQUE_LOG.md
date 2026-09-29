# Critique log

Three rounds of reading `CONVERSATION_TRANSCRIPTS.md` against the thirteen
principles in `VOICE.md` and against the persona. Every fix is paired with a
scenario assertion, so the violation cannot come back silently.

The rounds stopped at three because round three's only finding was one already
scheduled to be checked mechanically, and a fourth read was turning up nothing
the lint and the harness were not already holding.

---

## Round 1

| Scenario | Principle violated | Change made |
|---|---|---|
| B1, and every confirmation naming goods | 10, cooperative: be clear. The sentence said something untrue. | "Ksh 3,100 to Bacon" reads as having paid a person called Bacon. The draft has one description slot holding either a party or goods, and the sentence had no way to tell them apart, so it always used "to". `extractDescription` now reports which the description turned out to be, `CaptureDraft` carries it, and the confirmation says "for bacon", "to Kevin" or "from Naivas". **Assertion:** B19 now sends all three shapes and asserts each preposition. |
| A2, D1, and every capture with a vague description | 3, reflect back in the user's own words. | An enrichment question was the entire first reply to "lunch 850 yesterday", so the figure and the date appeared to have gone unheard. What landed is now said back (`ack.captured`) before more is asked for. **Assertion:** D1 requires `ack.captured` and the echo of both the amount and the date, before `enrich.where`. |
| Every scenario using `startInCapture` | 13, consistent persona: the transcript is the artefact the owner reads. | Transcripts began mid-conversation, with the mode question answered off screen, so the bot looked as though it had skipped its own questions. The report now renders the walk in to the capture state. Assertions still start clean, so a scenario cannot accidentally assert on the preamble. |

## Round 2

| Scenario | Principle violated | Change made |
|---|---|---|
| G3 | Voice: no em dashes. | `askWhich` built "Which one — Bacon, or Tomatoes?" by hand, outside the registry, so the lint could not see it. Both the question and the item labels are registry entries now. **Assertion:** the voice lint's "no id the code asks for that does not exist" check covers it, and G3 asserts the copy id. |
| B14b, and every second described line | 12, end every non-terminal turn with a clear next step. | The efficiency tip was emitted after the question, so the turn ended on an aside and the user was left looking for what they had been asked. It now comes first. **Assertion:** new scenario B20 requires `nudge.efficiency`, `endsWithNextStep()` and that the date question is what is pending. |
| Whole catalogue | 12, mechanically. | Added a transcript-wide check that every non-terminal turn ends in a question, options, or a stated action. It found one violation (the tip above) and now reports zero. |

## Round 3

| Scenario | Principle violated | Change made |
|---|---|---|
| J8, K2 | 5, acknowledge before acting. 10, be relevant. | Frustration was acknowledged and then followed by `zero.escape`: "I'm not getting there by asking, so let's try something else." That is what is said after failing to understand someone, and saying it to a person who simply told you the app was annoying reads as not having listened to that either. It has its own line now. **Assertion:** K2 requires `emotion.simplestPath` and forbids `zero.escape`. |
| K2 | 6, offer controlled options. An option that leads nowhere is worse than none. | "One question at a time" was offered and did nothing: no handler existed, so tapping it fell through. It now sets a flag that stops two open slots being batched into one turn. **Assertion:** K2 taps it and asserts the next two questions arrive singly, with no follow-on clause. |
| C5, J1, and every detour | 1 and 4: never ask again for what was given; reference earlier details. | A parked question came back in its generic form ("When was that?") after having been asked as "When was the bacon?". A differently worded question is a second question, which is the opposite of resuming. It now comes back as it was asked. **Assertion:** `resumes()` treats the subject-naming form as the same question, and the mobile e2e replay asserts the exact wording returns after an off-topic detour. |

---

## What the rounds did not find, and why that is worth saying

No em dashes, emoji, Title Case, banned words or over-length messages survived
into round 1: the voice lint had already failed the build on all of those
during Phase 1, which is the point of having it.

No scenario was ever made to pass by weakening an assertion. Three expectations
were changed during the pass, each because it was wrong about the flow rather
than because the flow was wrong; all three are recorded with their reasons in
the change log at the foot of `CONVERSATION_SCOREBOARD.md`.

---

# The day card and the receipt: a visual critique log (Phase 6)

Three rounds of actually rendering the day card and the sales receipt through
the real app — Active Mode, the real chat conversation, real PNG/PDF exports
— and looking at the resulting images, rather than trusting the geometry
tests alone to mean the design reads well. The geometry suite (`dayCard/
layout.test.ts`, `receipt/layout.test.ts`) already proves nothing overflows,
collides, or drops below the text floor; this pass is about whether what it
allows to render actually looks right.

## Round 1 — the day card's adaptive rules, each on a real render

Fixtures, each pasted/typed through the real Active Mode screen and exported
as a real PNG (`renderDayCardPng`, real embedded fonts, no font substitution):

| Fixture | What it exercises | Result |
|---|---|---|
| One M-Pesa sale + three lump sums with counts, one without | The 30%-missing-time tile swap (peak hour → biggest sale), the lump-sum exclusion from sale count/average, three-bucket bars | Correct on every count: 24 sales (14+9+1, the uncounted Unsorted lump sum excluded), "Average excludes cash entered as a lump sum." shown, BIGGEST SALE tile shows Ksh 4,200 |
| Two sales of Ksh 45,000,000 and Ksh 12,000,000 | The hero's shrink-to-fit at genuinely large figures | "Ksh 57,000,000" and "Ksh 28,500,000" both sit comfortably inside their boxes, no clipping |
| Two sales, no bucket ever created | The single-bucket ("All in Unsorted.") collapse with zero named buckets | Collapses correctly; the peak-hour tile still resolves (arbitrarily, between two one-sale hours — expected, not a bug) |

No defect found. This is the first time several of these paths (a real
tile-swap, a real nine-figure hero, real all-Unsorted data) had been seen as
pixels rather than as a geometry assertion.

## Round 2 — the receipt: a long name, a discount, and the two PDF exports

| Fixture | What it exercises | Result |
|---|---|---|
| A 57-character business name, two sales itemised | The receipt's business-name shrink-to-fit at genuine length | Fits on one line at a reduced size; the editable field above the card (plain HTML, not a primitive) wraps normally, as expected for an ordinary text input |
| An itemised sale with a discount applied via the reconciliation prompt | The discount line, `-Ksh` sign, subtotal/discount/total ordering | Reads correctly: Subtotal, Discount −Ksh 50.00, TOTAL Ksh 1,600.00 |
| The same receipt, exported as PDF and rasterised (`pdftoppm`) to actually view the pixels | Whether the PDF backend (a separate code path from canvas/DOM — its own font embedding, its own baseline math) agrees with what the screen shows | Matches the in-app preview closely: IBM Plex Mono renders correctly, torn edges, QR code and every line are all in the right place. (`pdftoppm` printed a harmless `Unknown character collection 'Adobe-Identity-H'` warning — a known, cosmetic quirk of jsPDF's Type0/CID font embedding; the rendered page itself is unaffected) |
| The day card's secondary "sales log" PDF export, rasterised the same way | The Phase 3.7 reuse strategy — overriding `merchant` to the bucket name so `getRecipientShort()` never falls through to a customer's name | Confirmed on the actual rendered page: "COMBO SALES · 01:05 PM" / "DESSERT SALES · 02:24 PM" in the description column, no customer name anywhere on the page |

No defect found.

## Round 3 — the densest fixture, in the theme not yet screenshotted at full export resolution

Seven M-Pesa sales across five buckets plus one cash sale, a stall name set
after the fact, exported as a PNG in light theme (round 1's dense fixture had
only been viewed in-app in light theme, and only in dark theme as a full
export). Five buckets correctly collapses to the top four plus a genuine "1
other bucket" row; contrast holds up at full resolution exactly as
`theme.test.ts`'s WCAG check predicts; nothing new.

No defect found. The rounds stop here, at three: round 3 was a check for
"does full-resolution light-theme rendering agree with what the in-app
preview and the automated contrast check already say," and it does — a
fourth round would be re-confirming the same thing a different way, not
looking for something new.

## What this pass did not re-verify, and why

- **Every arithmetic identity and adaptive-collapse rule** (single bucket,
  >4 buckets, the tip/discount/unexplained three-way split, the peak-hour
  compact-form fallback) already has a dedicated, passing unit test against
  the deterministic estimator (`dayCard/model.test.ts`,
  `dayCard/layout.test.ts`, `receipt/model.test.ts`,
  `receipt/layout.test.ts`). This pass sampled a representative subset of
  those paths as real pixels rather than re-deriving all of them a second
  time by hand.
- **A live reconciliation gap** (items and the amount received genuinely
  disagreeing) turned out to be difficult to reach honestly through the
  conversational engine alone: correcting a transaction's amount after the
  fact rescales its line items proportionally rather than leaving them
  stale, which is itself a reasonable, existing design choice — line items
  never silently drift out of sync with the total. The discount fixture
  above was produced with one direct, documented IndexedDB patch for this
  one-off visual check; the *logic* is fully covered by
  `receipt/model.test.ts`'s tip/discount/unexplained suite, and the *prompt
  UI* itself was exercised the same way and confirmed working end to end
  (screenshot not kept, since it duplicates what round 2's discount fixture
  already shows once resolved).
- **The real bug this whole pass did catch** — `OverlayStackProvider`'s
  `register`/`unregister` being recreated every render, putting any open
  `StackedPanel` into a silent infinite-render loop — was found by watching
  the browser console during ordinary feature testing, not during this
  formal three-round pass. It is recorded in the Phase 3 commit message
  rather than here, since it was a pre-existing defect in shared
  infrastructure, not a day-card- or receipt-specific design problem this
  critique loop exists to catch.
