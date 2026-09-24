# Conversational flow discovery sweep

A self-directed probe of the typed-capture flow, looking for defects that have
not yet been reported. Every bug in this project's history has been found by a
user noticing a broken conversation; the point of this sweep is to find the
next few before they do.

Audit only. No code was changed while producing it.

---

## 1. Method

Messages were driven through the production composition path — the same
`composeDescription` / `composeDraftAnswer` / `openSlots` / `composeSlotQuestion`
/ `partyQuestion` chain that `ChatScreen`'s `askNextField` calls — rather than
through the extractors in isolation. Where the finding was about what ends up
on a document, the probe continued into `buildSelfReportedTransaction`,
`computeReceiptData` and `buildDocModel`, and read the strings the HTML and PDF
actually draw.

Roughly **110 distinct messages** across about **25 flows**, in six batches:

| Batch | What it probed |
|---|---|
| 1 | mixed currencies, zero/free/negative amounts, repeated identical items, an amount or date stated twice with different values |
| 2 | a paragraph-length message, correcting one line of a one-sentence itemisation, cancel and meta-questions arriving mid-itemisation, the batched-slot mechanism against itemised input, lowercase party names, goods filling the party slot in each of the four document types |
| 3 | number forms (`45.5k`, `2.5m`, `1,250.75`, `0.5`, `1e5`, `/=`, `/-`), currency symbols, an item named with no price, future and too-old dates, direction on a sales receipt, a second free-text message folded into an existing draft, a currency correction, empty and junk input |
| 4 | wordy amounts as an answer to "how much?", Swahili numerals as an answer, direction verbs, bare numerals carrying a quantity, adding an item in a follow-up message |
| 5 | four point-of-sale messages rendered all the way to the document model |
| 6 | every phrasing of a zero amount, as an answer to the amount question |

Document types: the four-type matrix was used wherever the type could plausibly
matter (the party slot, the direction of a sale, the rendered document).
Elsewhere the sweep ran through `expense_summary` and `point_of_sale`, on the
basis established in the previous pass and re-checked here — nothing in
extraction reads the document type, so a shape that works in one works in all
four. The standing fixture harness already asserts that for five shapes.

**Everything below was confirmed by reproduction, not by reading code.** Four
findings that looked severe were additionally checked against `afef1b48`, the
commit before this pass began, to establish they are pre-existing rather than
introduced by Phases 1 and 2. All four are pre-existing.

---

## 2. Confirmed defects

### D1 — Two currencies in one message: one of them silently becomes the whole total

**Message:** `a chip for 200 USD and lunch for 500 bob`

**Observed:** amount `200`, currency locked to `USD`, no itemisation, and the
confirmation reads **`$200. Right?`** The 500 bob is gone without a word.

**Root cause:** `extractLineItems` computes `mixedCurrency` correctly and
`extractDescription` discards the itemisation when it is set — deliberately, so
that dollars are never added to pounds without a rate. But the very next line
falls back to the single best-scoring amount: `amount = itemisation ?
itemisation.total : singleAmount`. So instead of leaving the amount open and
asking, the flow fills it with whichever figure scored highest. `mixedCurrency`
has exactly one reader in the codebase and that reader only ever throws the
itemisation away; nothing anywhere tells the user.

**What the user experiences:** they describe two purchases in two currencies and
are asked to confirm one of them, as the whole transaction, in the other one's
currency. `ram 5000 USD, monitor 200 GBP` behaves identically — `$5,000`.

---

### D2 — A quantity straight after a transaction verb is read as the amount

**Message:** `sold 3 chapati for 150` (also `they bought 3 chapati for 150`)

**Observed:** amount `3`. Rendered as a sales receipt, **TOTAL PAID reads
`Ksh 3.00`**.

**Root cause:** the bare-number rule accepts a figure with a money cue word
immediately before it, and `sold` / `bought` are cue words. `3` therefore
qualifies as money, scores as well as `150` (both are near the start and both
sit in positive context), and wins on order. `NOT_MONEY_AFTER_RE` blocks
`3 x` and `3 pcs` but not `3 chapati` — a bare count followed by the thing
counted. The two-price segment then also disqualifies the line-item reader
(`matches.length !== 1`), so there is no itemisation to correct the total
either.

**What the user experiences:** a receipt handed to a customer for a Ksh 150 sale
saying Ksh 3.00. Pre-existing; confirmed identical at `afef1b48`.

---

### D3 — A follow-up message replaces the amount instead of adding to it

**Messages:** `bacon for 3100 and tomatoes for 400`, then `oh and airtime for 30`

**Observed:** after the second message the draft holds `lineItems = [Bacon 3100,
Tomatoes 400]` but `amount = 30`, and the description has been replaced with
`Oh, airtime`. The two figures on the document then disagree with each other.

**Root cause:** `composeDescription` folds a later free-text message into the
same draft with `amount: r.amount ?? draft.amount` and `recipient: r.recipient
?? draft.recipient`. Both are *replace-if-present*, not *add*. The second
message yields an amount, so it wins outright. `lineItems` uses the same rule
and happens to survive only because the second message has one price and so
produces no itemisation — which is what leaves the two in contradiction.

The simpler form is worse still: `bacon for 3100` then `and tomatoes for 400`
ends with amount `400`, recipient `Tomatoes`, and the bacon gone entirely.

**What the user experiences:** they add a forgotten item and the earlier ones
vanish, or the total collapses to the last thing they said while the itemisation
still lists everything. Pre-existing.

---

### D4 — A single non-Shilling document totals itself in Shillings

**Message:** `They bought credits... 500 USD on call time. And 250 USD on sms time.`

**Observed:** the itemisation rows read `USD 500.00` / `USD 250.00`, and the hero
figure and the bold total read **`Ksh 750.00`**.

**Root cause:** `buildTotals` branches on `d.isMultiCurrency`. With one currency
it takes the plain path, which formats every total with `fmt()` — and `fmt()`
hardcodes the `Ksh` prefix. The per-row amounts use the currency-aware
`fmtCurrency`, so the rows and the total disagree. Only a document mixing two
currencies gets currency-correct totals.

**This is outside the conversational capture flow**, in document rendering.
Flagged for a decision rather than assumed, per the Phase 4 stop rule.

---

### D5 — A sale is recorded as money going out

**Message:** `they bought 3 chapati for 150`, as a `point_of_sale` receipt

**Observed:** direction `sent`, confidence 95, `directionUnresolved = false` — so
no question is asked, and the receipt records money leaving the merchant.

**Root cause:** `conversationalDirectionHint` maps `bought` to `sent`, which is
right for someone recording their own spending and exactly backwards on a
receipt the merchant is issuing. The document type is never consulted. Related:
`sold` and `sell` are missing from that verb list altogether, so `sold chapati
for 150` comes back unresolved and the flow stops to ask "money in or out?"
about a sales receipt, where there is only one possible answer.

**What the user experiences:** a sales receipt with the sign inverted, or an
unnecessary question on every sale phrased with "sold".

---

### D6 — "came to 250" loses the price, and corrupts the next item's description

**Message:** a paragraph-length shopping list (ten priced items), containing
`then lunch at the kibanda came to 250,`

**Observed:** nine line items instead of ten; total `2,410` against a stated
`2,660`; and one item's description reads
`Lunch at the kibanda came to 250, way home i picked up bread`.

**Root cause:** `to` is not in `MONEY_CUE_RE`, so `came to 250` carries no
recognised amount. The whole clause then falls through as a price-less fragment
and is carried forward as the *description* of the next priced item. The
missing Ksh 250 and the mangled description are one cause, not two.

**What the user experiences:** a document whose total is short by one item, with
no indication anything was dropped. Segment splitting itself held up fine at
paragraph length — nine of ten items came through cleanly and nothing was
truncated, so this is about the cue-word list, not about message length.

---

### D7 — The Kenyan `/=` bare-money rule has never worked

**Message:** `lunch 500/= and beer 300/=`

**Observed:** no amount at all; the flow asks how much.

**Root cause:** `isBareMoney` checks `DATE_CHAR_AFTER_RE` (`/^[/:]/`) before it
checks `TRAILING_SLASH_RE` (`/^\s*\/=/`), and returns `false` on the first. A
slash after a number is treated as a date separator, so the `/=` branch below it
is unreachable. `lunch for Ksh 250/=` works only because the `Ksh` makes it
currency-tagged and it never takes the bare path. `1200/-`, the other common
Kenyan form, is not recognised in any path.

**What the user experiences:** the most distinctively Kenyan way of writing a
price extracts nothing.

---

### D8 — Swahili numerals are not understood as an answer to "How much was it?"

**Answer:** `elfu tatu` to the amount question

**Observed:** `parseAmountReply('elfu tatu')` returns `null`; the question is
asked again.

**Root cause:** `parseAmountReply` calls `parseAmountAnswer` directly and never
runs `normalizeSwahiliNumerals`. Every other entry point normalises first — see
`readable()` in `conversationalCapture.ts` — so `nilinunua bacon kwa elfu tatu`
reads as 3,000 in free text and the identical numeral fails the moment it is
given as an answer.

**What the user experiences:** the flow understands their Swahili until it asks
them a direct question, then stops.

---

### D9 — A lowercase party name loses the whole message

**Message:** `gave mum 2000` (also `paid kevin 500`, `sent my landlord 15000`)

**Observed:** amount `null`, recipient `null`; the flow asks for both.

**Root cause:** the only signal for a party name is capitalisation
(`parsers/names.ts`), which the Phase 2 fix depends on to let a cue word reach
across the name. Nothing in the message is capitalised, so the cue cannot reach
`2000` and no recipient is found either. The message *is* recognised as having
transaction shape, so it is not the zero-understanding path — it is simply
mined for nothing.

**What the user experiences:** typing the way most people type on a phone — no
capitals — costs both fields. This is the single most likely of these to be
common in practice.

---

### D10 — Zero is unrecordable, and the amount question has no way out

**Answers tried:** `0`, `0 ksh`, `free`, `nothing`, `it was free`

**Observed:** all five rejected; `openSlots` still lists `amount`; the question
repeats. `openSlots` treats an amount as present only when `> 0`, and the
`field-amount` branch has no retry cap and offers no escape — unlike the date,
which offers "leave it blank" after two unreadable answers.

**What the user experiences:** a genuine dead end. Describing something that was
free, a gift, or a zero-rated line leaves the flow asking the same question
forever, with cancelling as the only exit.

---

### D11 — Two figures in one message: the first wins, silently

**Message:** `spent 500 yesterday, actually 600`

**Observed:** amount `500`; confirmation reads `Ksh 500, on 11 September 2026`.
The 600 is never mentioned. `paid 500 on 1/9/2026 and 700 on 2/9/2026` likewise
keeps only 500 — and, because the two dates conflict, ends with no date at all.

**Root cause:** `extractAmount` returns the single best-scoring candidate and
nothing downstream knows a second one existed. The same message given as an
*answer* behaves the same way: `composeDraftAnswer(..., 'amount', '500 no wait
600')` accepts 500.

---

### D12 — Two dates in one message: the last wins, silently

**Message:** `bought milk for 500 yesterday and today`

**Observed:** date resolves to today, no question asked, straight to
confirmation. The user named two days and was told about neither choice.

---

### D13 — An item explicitly added while answering a question is dropped

**Setup:** draft holds bacon + tomatoes; the flow asks for the date; the user
replies `yesterday, also airtime for 30`

**Observed:** the date lands; the amount stays `3,500` and the items stay two.
The airtime is discarded without comment.

**Root cause:** `absorbAnswer` fills only *empty* slots — a deliberate rule that
stops a stray number in a date reply displacing a known amount. But an
explicitly added item is not a stray number, and there is no path for adding to
an itemisation from an answer.

---

### D14 — Junk words become the description

**Message:** `got 500 back`

**Observed:** recipient `Back`. The document's description column reads "BACK".

**Root cause:** `back` survives `tidy` and is not in `NON_ITEM_WORDS`, so the
sole-item reader hands it over as the goods. The same class produced `E5` from
`sold it at 1e5`.

---

## 3. Improvements worth making

Not defects — these all behave as designed. They are places where the design
costs the user something.

**I1 — "It was free" is met with "How much was it?"** The message is understood
as having transaction shape and no amount, which is technically true. Saying so
explicitly ("Nothing? I'll put zero") would be better than a question the user
has just answered. Bound up with D10, which is the defect half of the same gap.

**I2 — Refunds and negatives have no representation.** `refund of -500`, `got
500 back`, `bread for 60, refund -20` all read as ordinary positive amounts or
nothing. The direction oracle sometimes catches "refund" as money in, so the
sign is sometimes right by accident; there is no way to state a negative line
inside an itemisation.

**I3 — Only figures can be corrected, never names.** `the tomatoes were actually
500` applies cleanly to the right line and moves the total. `it was pork not
bacon` comes back with "I can tell something needs changing but not what to."
Correcting a mis-transcribed item name is at least as likely as correcting a
price.

**I4 — A named item with no price is folded in silently.** `bacon for 3100,
tomatoes, airtime worth 30` produces two lines, the second described as
"Tomatoes, airtime" at Ksh 30. That is the modifier rule doing exactly what it
was built to do, and here it is probably wrong — the user named three things and
gave two prices. Asking "what did the tomatoes come to?" would be better than
quietly merging.

**I5 — A currency cannot be corrected once locked.** `sold it for 500 USD`, then
`actually it was 500 GBP`, stays USD. The first-explicit-mention-wins rule is
right for silence but wrong for an explicit correction.

**I6 — Numbers written as words are not read.** `five hundred`, `two thousand`,
`a thousand bob` all return nothing as an answer to "how much?". Swahili
numerals *are* modelled (`elfu tatu`) — English ones are not.

**I7 — `on_behalf_of` is asked "Where was this spent?" and filled with goods.**
The party slot takes the item description in all four types, so a reimbursement
claim ends up with "Laptop" where the wording promises a place. Low cost — the
field is the document's description column either way — but the question and the
answer do not match.

**I8 — A quantity with bare numerals extracts nothing.** `3 x sodas 450, bread
120` yields no amount and no items, because neither figure has a cue word before
it and the `x` form supplies none. `3 x sodas Ksh 450, bread Ksh 120` works.

---

## 4. Probed and sound

For calibration — things that could plausibly have been broken and were not:

- **Repeated identical items are not collapsed.** `bought bread for 60, then
  more bread for 60` gives two lines totalling 120. The SMS pipeline's
  near-duplicate logic does not reach typed itemisations.
- **Correcting one line of a one-sentence itemisation works.** `bacon for 3100,
  tomatoes at 400, airtime worth 30` then `the tomatoes were actually 500`
  targets line 2, and the total moves to 3,630. An unqualified `actually it was
  500` asks which of the three rather than guessing.
- **Cancel mid-itemisation is handled.** It summarises what is already captured
  ("Bacon (Ksh 3,100), Tomatoes (Ksh 400) and 1 more") and offers discard or
  keep, rather than dropping the lot.
- **A meta-question mid-itemisation splits cleanly.** `bacon for 3100, tomatoes
  at 400, also what currencies do you support` separates into the data clause
  and the question, and the question clause is not mined for an amount.
- **Paragraph-length messages do not truncate.** Ten segments, nine items, no
  cap hit and nothing dropped past a limit — the one loss was D6's cue word.
- **Number shorthand is solid.** `45.5k`, `2.5m`, `1,250.75`, `0.5` all read
  correctly, as do the `$` and `€` symbols.
- **Dates out of bounds are refused, not guessed.** Tomorrow and 1/1/2020 both
  leave the date open with the parser's own reason.
- **Empty, whitespace and gibberish reach the zero-understanding path** rather
  than a misleading targeted question.
- **The numeral-ownership guard holds.** `3 days ago` still fills only the date.
- **The Phase 1 and Phase 2 work holds** across all four document types, per the
  shared fixture harness.

---

## 5. Ranked

Ordered by what it costs the user if left alone: a wrong figure on a document
someone acts on, then a lost transaction, then friction.

| # | Finding | Class | Why here |
|---|---|---|---|
| 1 | D2 quantity read as the amount | Wrong figure | `Ksh 3.00` on a receipt for a Ksh 150 sale. Silent, plausible-looking, and the customer is holding it. |
| 2 | D1 mixed currencies collapse to one figure | Wrong figure | Confirms `$200` for a message describing $200 and 500 bob. |
| 3 | D3 follow-up message replaces the amount | Wrong figure | Total collapses to the last item while the itemisation still lists all of them — the document contradicts itself. |
| 4 | D5 a sale recorded as money out | Wrong figure | Sign inverted on a sales receipt, with no question asked. |
| 5 | D4 non-KES document totalled in Shillings | Wrong figure | Rows say USD, the total says Ksh. Outside the capture flow — needs a decision. |
| 6 | D6 "came to 250" | Lost line + wrong total | One item silently missing and the total short by its price. |
| 7 | D7 `/=` never worked | Lost transaction | A common Kenyan price format extracts nothing at all. |
| 8 | D9 lowercase party names | Lost fields | Likely the most *frequent* of all of these; costs two fields, not a wrong figure. |
| 9 | D10 zero unrecordable, no escape | Dead end | The user cannot proceed at all, but nothing wrong is recorded. |
| 10 | D11 two figures, first wins silently | Wrong figure, low frequency | Real but an unusual way to type. |
| 11 | D13 added item dropped in an answer | Lost line | User is told nothing, but the shape is less common than D3. |
| 12 | D8 Swahili numeral in an answer | Lost input | Fails only at the answer step; free text works. |
| 13 | D12 two dates, last wins silently | Wrong field | A date is less costly to get wrong than a figure. |
| 14 | D14 junk as description | Friction | Visible and easily corrected by the user. |
| 15 | D13 → I4 unpriced named item merged | Friction | Defensible behaviour; better handled by asking. |
| 16 | I1 / I2 free and negative amounts | Friction | Feature gap rather than misbehaviour. |
| 17 | I3 item names uncorrectable | Friction | |
| 18 | I5 currency uncorrectable | Friction | |
| 19 | I6 English words as numbers | Friction | |
| 20 | I8 bare numerals with a quantity | Friction | Adjacent to D2; may fall out of fixing it. |
| 21 | I7 `on_behalf_of` wording vs. content | Friction | Cosmetic. |

---

## 6. Suggested sequencing

**First, the four wrong-figure defects inside the capture flow (1, 2, 3, 4).**
These are the only findings where the user acts on something false without being
given any reason to doubt it — the project's own ordering puts them above
everything else. Take D2 first: it is the narrowest fix (a count followed by the
thing counted is not a sum) and it sits in the same guard list that Phase 2 just
touched, so the guard tests are already in place. D1 and D3 are both the same
underlying shape — a fallback quietly filling a field the flow had good reason
to leave open — and are worth doing together so the "leave it open and say why"
path is written once. D5 needs the document type to reach the direction oracle,
which is a small piece of new wiring, so it goes last of the four.

**Then D4, but only after a decision.** It is a document-rendering change, not a
capture change, and it touches every document with a non-KES currency. Worth
confirming before doing.

**Then the three lost-input defects (6, 7, 8).** D6 and D7 are both one-line
widenings of existing recognition rules, cheap and low-risk. D9 is the
interesting one: it cannot be fixed by relaxing the capitalisation rule without
re-opening what Phase 2 just closed, so it likely needs a different signal
(position after a payment verb, a short closed list of relationship words like
"mum"/"landlord"/"mama"). Worth its own careful pass rather than being bundled.

**Then D10**, which is small and closes a genuine dead end — give the amount
question the same escape the date question already has, and let zero mean zero.

**Then the rest, in rank order.** D11/D12/D13 all share a shape — a second value
arriving where one is expected and being dropped without a word — and might be
worth one common treatment rather than three.

**Add each fixed defect to the shared extraction-shape fixture set as it is
fixed**, so the harness carries it across all four document types from then on.
That is what stops this list being rediscovered.
