# Active Mode and receipt data audit (Phase 0)

No product changes in this pass. This is what exists today, read from the
actual code, so the phases that follow build on fact rather than assumption.

---

## 1. What an Active Mode sale actually carries

Every Active Mode capture is a `ParsedTransaction`, produced either by
`parseAllMessages` (a pasted message, `session.ts` `captureFromPaste`) or by
`buildSelfReportedTransaction` (typed shorthand, `captureFromTyped`). Both
paths are then run through `applyActiveModeDirection`, which only ever fills in
`type`/`directionAssumed` when direction was otherwise unresolved.

| Field | Stored on a pasted (M-Pesa) sale | Stored on typed shorthand | Where it is lost if it is lost |
|---|---|---|---|
| **amount** | Yes, exact | Yes, exact (required — `captureFromTyped` refuses without one) | Never lost; the one thing both paths guarantee |
| **date** | Yes, from the message | Yes, from the typed text or `now` | Never lost |
| **clock time** | Yes — `time` is populated from the message's own timestamp (`'HH:MM AM/PM'` string, see `parsers/index.ts` / `extractors/date.ts`) | **No** — `buildSelfReportedTransaction` always sets `time: dated ? fields.date.toLocaleTimeString(...) : ''`, and `captureFromTyped` passes `date: r.date ?? now`. If the typed text itself carried no date, `now` is used, so the "time" is actually whatever the browser's clock read at the moment of capture, not a stated time — which happens to be correct for a live sale, but there is no `timeStated` flag distinguishing "the message said 1:15 PM" from "this is when the record was made" | Not lost, but conflated: a self-reported sale's `time` is really "logged at", never a fact the vendor stated |
| **reference code** | Yes — `transactionCode`, with `codeIsSynthetic` set on any invented one | A synthetic code is always generated (`extractCode` with no raw text to find one in) | Never lost, but a typed sale's code is never a real M-Pesa reference — `codeIsSynthetic: true` already flags this correctly |
| **M-Pesa balance** | Yes — `balance: number \| null`, extracted by `extractBalance` (`parsers/extractors/amount.ts`) whenever the message states one | Always `null` — nothing to extract from typed text | **Kept as-is going into Phase 1** — the field already exists on `ParsedTransaction` and is already populated for every parsed message. Nothing new needed for the day card's balance-check note (Phase 3.5) beyond reading a field that is already there |
| **sender** | Yes, for a received message (`sender`) | Set to `t.recipient` only if direction resolved by the ordinary oracle; otherwise left as whatever `buildSelfReportedTransaction` derives (`type === 'received' ? recipient : null`) | Never lost for a parsed message. For typed shorthand there generally is no sender — "combo 350" names no person — so `sender` is usually null, which is correct, not a loss |
| **bucket label** | Yes — `bucketLabel`, set by `fileInto` the moment a chip is tapped | Same | Never lost |
| **direction** | Yes — `type`, resolved by the ordinary SMS oracle (balance / keyword / structural), or defaulted to `received` with `directionAssumed: true` if none of those settle it | Same default applies (`captureFromTyped` sets `directionAssumed: true` when the extractor's own direction is unresolved) | Never lost |
| **pasted vs typed** | Not stored as its own field. `dataSource` is `'sms_verified'` for anything through `parseAllMessages`, `'self_reported'` for anything through `buildSelfReportedTransaction` — which is exactly the pasted/typed distinction, just under an existing, differently-named field | — | **Not lost** — `dataSource` already carries this distinction. Phase 2's "how it was entered" column (pasted / typed / lump sum) needs one more value than `dataSource` currently has room to express (a lump sum is also `self_reported`, but is a third kind of entry) — see the decision below |

**Decision needed for Phase 2, not a Phase 0 gap:** distinguishing a *live* typed
or pasted entry from a *lump sum* (Phase 2.4) needs a new signal, because
`dataSource: 'self_reported'` cannot tell them apart and `time` cannot either
(a lump sum has no time; neither does a typed sale that happens to have no
clock reading distinct from "now"). This becomes an explicit `entryMethod`
field on the transaction in Phase 2 (see `DECISIONS.md`-adjacent note in that
phase — it is authorised there, not deferred, because Phase 2's requirements
depend on it existing).

## 2. What Finish produces today, and how it is treated elsewhere

- **Finish** (`ActiveModeScreen.handleFinish`) builds a `TrackedDocument` via
  `buildDraft` with `documentType: 'expense_summary'` and
  `capturedViaActiveMode: true`, then flips `status` to `'approved'` and calls
  `saveDocument` / `saveApproved`. **It never calls `recordSession`** (the
  all-time aggregation entry point) and never calls `deliverInsights` (the
  chat's insight pipeline) — both of those are wired only from
  `ChatScreen.tsx`'s own `handleApprove`, which Active Mode does not go
  through.
- **History** (`HistoryScreen.tsx`) lists it exactly like any other
  `expense_summary`: `TYPE_META['expense_summary']` ("Summary", `FileText`
  icon), filterable under the "Summaries" chip, no separate treatment. Nothing
  in History today distinguishes an Active Mode day from a hand-built expense
  summary except the total and the date.
- **Rendering** (`documentLayout.ts`): `buildBuckets()` adds an extra
  "buckets" section to the shared editorial layout when
  `meta.capturedViaActiveMode` is true and at least one transaction carries a
  `bucketLabel` — a plain list of bucket subtotals between the hero total and
  the itemisation. This is the section Phase 1.4 removes, because once every
  Active Mode document is `daily_sales` (a type `buildDocModel`'s per-type
  tables do not — and per this project's own constraint, must not — branch on
  for a bespoke design), `capturedViaActiveMode && documentType ===
  'expense_summary'` can never both be true for a document built after this
  pass. It stays reachable only for already-migrated history, and the
  migration converts exactly those documents to `daily_sales`, so after
  migration the branch is dead in every case, not just new ones.
- **All-time aggregation and insights, concretely:** because `recordSession`
  is never called from Active Mode, an approved Active Mode day does **not**
  currently feed all-time totals or generate insights, in practice, today.
  `pipelineEligibility(documentType)` — the gate that exists for exactly this
  purpose — happens to return `{ insights: true, aggregation: true }` for
  `expense_summary`, which is what an Active Mode document's type has always
  been, so if anything in the future called `recordSession` on one (the chat's
  own approve flow, if a draft were ever opened there; a batch "recompute from
  history" tool; anything scanning approved `expense_summary` documents) it
  would count as the user's own spending, which is wrong — a day's sales are
  income, not the user's spending. Phase 1.3 closes this by moving Active Mode
  to its own `daily_sales` type and keeping it out of
  `pipelineEligibility` in both columns. **This is a latent risk being closed,
  not a currently-observed behaviour being reversed** — worth stating plainly
  rather than the "used to count" framing, because it did not actually happen
  in the shipped app; describing it as a live behaviour change would overstate
  what changes.

## 3. What a vendor can do today with a single entry

- **Remove one:** nothing. There is no delete/undo on an individual filed
  sale anywhere in `ActiveModeScreen.tsx`. The only related affordance is the
  non-blocking duplicate warning's "Discard" link, and that only exists
  *before* a capture is filed into a bucket (it discards the still-`pending`
  transaction, never something already filed).
- **Edit one:** nothing, for the same reason — once filed, a transaction sits
  in `transactions` with no UI path back to it. (Bucket rename/delete
  operates on the *bucket*, not on one sale.)
- **See a list of today's entries:** nothing beyond the per-bucket chip
  tallies (name, subtotal, count). There is no chronological list of
  individual sales anywhere on the screen.

**This means Phase 2's "undo" and "compact list of today's entries, from which
one can be removed" is net-new for every entry, cash and M-Pesa alike** — not
a cash-only feature bolted onto an existing removal mechanism. Building it once
for both, rather than a cash-only path, is the only sane design and is what
Phase 2 does.

## 4. What exists today for `point_of_sale`

- **Shop details:** `MerchantProfile { businessName: string; contact: string |
  null }`. Two fields only. Set via the chat conversation's `business-name`
  question (`mode.posName` in the copy registry) for `businessName`, and via
  the tap-to-edit `EditableLine` in `ChatReceipt.tsx` for `contact`. Nothing
  else — no location, PIN, served-by, sold-to, note, discount, or payment
  fields exist on the type or anywhere in the conversation.
- **Items:** `LineItem { description; quantity: number | null; unitPrice:
  number | null; amount }`, already general enough for quantity and unit
  price — populated by `extractLineItems` / `extractSoleItem`
  (`parsers/extractors/lineItems.ts`), which already handles multi-item
  messages and per-unit pricing. Nothing new needed here for Phase 4's typed
  cash-item capture; it is the same extractor the conversation already calls.
- **Payment method, reference, payer name:** not modelled as `point_of_sale`
  concepts at all today. A `ParsedTransaction` built from a pasted M-Pesa
  message already carries `provider` ('M-PESA' / 'Airtel Money' / 'T-Kash' /
  ...), `method`, `transactionCode`, and `sender` (the payer's name, for a
  received message) — every one of these fields already exists and is already
  populated by the ordinary SMS pipeline. What is missing is a *document*-level
  place to hold them for the seller's own typed entry (cash, or a
  reference typed by hand rather than pasted) and the "how do we know this"
  provenance line the receipt has to print. Both are new, optional fields —
  authorised in the prompt's hard constraints.
- **Current layout and header:** `point_of_sale` renders through the same
  `buildDocModel` / `renderDocHTML` / `renderDocPDF` as the other three
  document types (`documentLayout.ts`). Its only per-type differences today
  are: the wordmark is the business name instead of "M-Track"; the title is
  "SALES RECEIPT"; the section label is "ITEMS"; `buildMetaFields` shows at
  most one line (`Contact`, else the covering date); and `buildLine` renders
  each transaction's `lineItems` as an indented sub-list under the description.
  There is no thermal-receipt styling, no torn edges, no QR-as-facts payload
  (the existing QR just links to `mtrack.vercel.app`, a marketing link, not a
  facts payload), and no amount-in-words. `ChatReceiptVisual.tsx` (the
  in-chat interactive card) is one shared component across all four document
  types — there is no `point_of_sale`-specific visual today.
- **A concrete, pre-existing bug worth fixing while in this code:**
  `generateReceiptRef()` (`receiptGenerator.ts`) derives the receipt number
  from `year+month+day+hour+minute` only, with no counter or randomness — two
  receipts built in the same clock minute get the *same* reference. It is also
  regenerated fresh on every render (`computeReceiptData` calls `new Date()`
  internally), so re-downloading the same approved document from History
  produces a *different* receipt number and a different "issued" date each
  time. Phase 4.11 ("two receipts in the same minute must not share a number"
  and "re-downloading from History reproduces the same layout exactly")
  requires both of these to be fixed for `point_of_sale`. Rather than touch
  the shared `generateReceiptRef` (used by all four document types, and out of
  this pass's scope to change), the new receipt layout stores its own
  `receiptNumber` once, on the `TrackedDocument`, the first time the document
  is built — an authorised new optional field — and reuses it on every later
  render.

## Rule applied throughout

Per the prompt: anything parsed but dropped before storage, whose type already
exists on `ParsedTransaction`, is kept starting in Phase 1 rather than treated
as a data-model change. The one field this rule actually applies to is
`balance` — already on the type, already populated, simply never read by
anything downstream until the day card's private balance-check note reads it
in Phase 3. Everything else audited above is either already fully retained
(amount, date, code, sender, bucket, direction, `dataSource` as the
pasted/typed proxy) or is a genuinely new capability with no prior data to lose
(cash entries, receipt provenance, shop detail fields) — both handled as
authorised additions in the phases that follow, never invented data.
