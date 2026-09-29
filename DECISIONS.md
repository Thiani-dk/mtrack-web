# Decision queue

Anything that touches a protected area, or needs the owner's own voice, is
written here rather than blocking the run. Every entry says what ships today, so
nothing is left half-built while it waits.

Protected areas, unchanged by this pass: the persisted data model, what
documents print, deletion of saved documents from chat, and any earlier owner
decision.

---

## D1. Who made M-Track (scenario I8)

**What the bot says today (placeholder, shipping):**

> I'm M-Track's assistant, a set of rules built for recording money on this
> device. I can't tell you more than that about who made me.

**Why it needs you:** any real answer is a claim about a person or a company,
and I should not invent one. It is also the line most likely to end up quoted.

**Proposed wording, once you decide:**

> M-Track was made by {name}. It runs entirely on your phone.

**Affects:** I8. The placeholder is honest and in voice, so this can wait
indefinitely without anything reading as broken.

---

## D2. Crisis wording and helpline (scenario K4)

**What ships today:** the crisis reply pauses the capture and says, without a
number:

> That sounds heavy, and I'm sorry. I'm a small tool for recording money, not
> someone who can help with this. Please reach out to someone you trust.

**Why it needs you:** a helpline number has to be verified against an official
source and confirmed as currently operating before it goes in front of anyone.
Printing a wrong or dead number in a moment like that would be worse than
printing none. I will not add one on my own authority.

**What I would add, once verified:** one line naming a Kenyan service and its
number, after "someone you trust". Nothing else changes.

**Triggers, for your review.** Deliberately conservative, and tested both ways.
Only explicit self-harm statements fire it. These must NOT and do not:
"this price is killing me", "I'm dying of hunger", "my phone died", "I'm dead
broke", "you're killing me". Scenario K4b exists to prove it.

**Affects:** K4, K4b.

---

## D3. Should a document print a time?

**Finding:** no surface prints one today. `buildSelfReportedTransaction` sets a
`time` field, the SMS parser fills it from the message, and nothing in
`documentLayout.ts`, `documentRender.ts` or `ChatReceiptVisual.tsx` reads it.

**Consequence, and why nothing was built:** the enrichment pass deliberately
does not ask for a time. Asking for something no document shows is exactly the
"every question has a reason" rule being broken.

**What printing one would take:** a row in the document's line model, a column
in the PDF and HTML layouts, and a decision about self-reported lines, which
have no real time. The natural answer is to print a time only where one came
from a transaction message, and nothing where it was typed. That is a change to
what documents print, so it is yours.

**Affects:** the enrichment section (D) generally. Nothing ships waiting on it.

---

## D4. Mirroring Swahili greetings

**What ships today:** input is read in English, Swahili and common Sheng; every
reply is in English. "Niaje" gets "Hello."

**The question:** should a Swahili greeting get a Swahili greeting back, while
the rest of the conversation stays English?

**The case for:** it costs one registry variant, and it reads as having been
heard.

**The case against:** a bot that says "Habari" and then conducts the entire rest
of the conversation in English is making a promise it does not keep, and the
next Swahili sentence the user tries will fail. The current behaviour is the
honest one.

**My recommendation:** leave it. Revisit if and when replies are translated
properly, which is a much larger piece of work than a greeting.

**Affects:** A6, A6b, J11.

---

## D5. Spending answers the stored data cannot give exactly

**What ships:** spending questions are answered from approved `expense_summary`
and `personal_note` documents on the device, for "this month", "last month", a
named month, "today" and "in total". `point_of_sale` and `on_behalf_of` are
never counted as the user's own spending, per the existing pipeline rule.

**What cannot be answered exactly, and is not estimated:**

- **"this week" / "last week".** Week boundaries are not stored. The answer says
  so and gives the nearest exact period instead, naming it.
- **Category totals.** Documents store a description per line, not a category.
  A merchant filter works because the merchant is a real stored value; "how much
  on food" does not, and is answered as a merchant question or declined.

**What exact answers would need:** either a stored category per line, or a
running weekly aggregate alongside the existing all-time one. Both are data-model
changes, so neither was built.

**Affects:** N1, N2. N2 ships as an honest "I can't split it by week, but here
is the month exactly".

---

## D6. Copy still outside the registry

**What ships:** the chat conversation's copy is all in
`src/lib/conversation/copy.ts` and linted. Three surfaces are not:

- the guided demo (`demoFlow.ts` and the `DEMO_*` constants),
- the SMS-batch narration (`parseNotices.ts`, `insights/generators.ts`),
- the Active Mode walkthrough.

**Why:** the demo is rebuilt in Phase 7 and migrating its copy twice is churn.
The narration is a generator, not a table: its sentences are assembled from
counts and figures. The Active Mode walkthrough is a different surface.

**What I would propose:** extend the voice lint to scan those files for em
dashes, emoji and banned words without requiring a full migration. That is a
small piece of work and I have not done it on my own authority because it will
report violations in copy you may have deliberately worded that way.

**Affects:** nothing in the scenario catalogue.

---

## D7. Cash in Active Mode, and a design note (Phase 2 of the cash/day-card/receipt pass)

No decision is queued here — everything Phase 2 needed was within the
explicitly authorised set (the `daily_sales` document type, the v6 migration,
`cash` as a payment method with an optional lump-sum count) or was a plain
implementation call with no owner-specific voice involved.

**Worth recording anyway: the cash-entry interaction, chosen from three
candidates.**

1. **Chosen — an overlay.** A "Cash" chip opens a small panel: pick a bucket,
   then pick an amount. Reuses the same `StackedPanel` visual language as the
   existing bucket long-press menu.
2. **Rejected — inline in the main capture area** (a segmented Cash/M-Pesa
   toggle). Risked exactly the failure the viewport tests exist to catch: a
   persistent extra row at 360×210 (the narrowest supported split-screen
   height) leaves no margin to spare, where an overlay costs the base layout
   nothing at all.
3. **Rejected — long-press a bucket chip**, reusing the gesture already bound
   to Rename/Delete. Screenshotted for comparison
   (`e2e/screenshots/cash-design-B-rejected-longpress.png`): the two purposes
   fight over one gesture, a vendor cannot tell before pressing which one they
   will get, and reaching the amount step still needs a second screen after
   it — no faster than the chosen design and considerably less discoverable.

Screenshots of the chosen design's three steps are in
`e2e/screenshots/cash-design-C-chosen-*.png`.

**Affects:** nothing in the conversation scenario catalogue — Active Mode is a
separate, non-conversational screen.
