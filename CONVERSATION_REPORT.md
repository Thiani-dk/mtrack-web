# Conversation layer v2: final report

Nine commits, Phase 0 through Phase 8. No new runtime dependency: the only
`package.json` change is two e2e suites and one report script.

---

## 1. Scoreboard, before and after

**25 of 104 scenarios at baseline. 110 of 110 now.** Run across the document
types each path applies to, that is 236 scenario runs.

| Section | Scenarios (start → end) | Passing at baseline | Passing now |
|---|---|---|---|
| A. Opening and mode choice | 9 → 10 | 1 | 10 |
| B. Capture | 19 → 23 | 8 | 23 |
| C. Clarifying questions | 8 | 3 | 8 |
| D. Enrichment | 7 | 0 | 7 |
| E. Confirmation | 9 → 10 | 1 | 10 |
| F. After saving | 5 | 2 | 5 |
| G. Corrections mid-flow | 3 | 1 | 3 |
| H. Cancel and restart | 3 | 3 | 3 |
| I. Help and meta questions | 10 | 0 | 10 |
| J. Off-topic and out of scope | 13 → 14 | 1 | 14 |
| K. Emotional content | 5 | 1 | 5 |
| L. Input robustness | 6 | 3 | 6 |
| M. Session and return | 1 | 1 | 1 |
| N. Spending questions | 3 → 5 | 0 | 5 |

Six scenarios were added beyond the catalogue while working: B17 and B18
(relative dates, and that they never leak into a description), B19 (the
preposition a description takes), B20 (the efficiency tip never ends a turn),
N1b and N1c (a named month with a merchant filter, and that a customer receipt
never counts as the user's spending).

**Blocked: none. Decision: none blocking.** Six entries are queued in
`DECISIONS.md`, each shipping a working placeholder rather than a gap: who made
M-Track, the crisis wording and helpline, whether documents should print a time,
whether to mirror Swahili greetings, what exact weekly and category totals would
need, and the three surfaces whose copy is still outside the registry.

The baseline is in `CONVERSATION_AUDIT.md`; the live scoreboard, regenerated
from a real run, is `CONVERSATION_SCOREBOARD.md`, with an expectation change log
at its foot.

---

## 2. The thirteen principles, and what enforces each

| # | Principle | Enforcement |
|---|---|---|
| 1 | Never ask for what was already given | `doesNotAsk(slot)`, used in B1, B3, C2, C3, D5, D6, L5. `openSlots` is the only thing that can produce a question, so there is no fixed question list to fall out of step with the draft |
| 2 | Every question has a reason | Scenarios C4b (why the amount is needed) and C5 (why the date is). No question exists for a field no surface prints: `DECISIONS.md` D3 records that check for the time |
| 3 | Reflect back in the user's own words | `echoes(text)` in B3, B6, B9, B11, B18, B19, C1, D1, G1, G2, N1 |
| 4 | Reference earlier details | The subject-naming questions (`ask.amountFor`, `ask.dateFor`), asserted by `echoes` in B3 and D1 |
| 5 | Acknowledge before acting on frustration or stress | K1, K2, J8, each asserting the acknowledgement copy id before anything else |
| 6 | Offer controlled options at choice points and after breakdowns | `offers([...])` in B7b, B10, C7, E2, H2, J10, K2. K2 also taps an option and asserts it does something, because an option that leads nowhere is worse than none |
| 7 | Change strategy after two failures | C7, end to end: the date gives up rather than asking a third time, and the slot it moves on to has the same cap. `notRepeatOfPrevious()` |
| 8 | Match confirmation to stakes | `confirm.summary` is the only explicit confirmation in the registry, at the one point where a record is saved. Everything mid-flow is confirmed implicitly, which `echoes` asserts |
| 9 | One-step corrections | E3, E4, E6, G1, G2, B6, and the mobile e2e replay. "No, 600" never restarts |
| 10 | Cooperative principle | The per-kind length limit in the voice lint, and a transcript-wide scan for over-long turns |
| 11 | Signpost | The batched-question form ("When was the bacon? And how much?") tells the user what is left; B3, C3 |
| 12 | End every non-terminal turn with a next step | `endsWithNextStep()` on 22 scenarios, the question-kind rule in the voice lint, and a transcript-wide check that currently reports zero violations |
| 13 | Consistent persona | One registry, one `TurnBuilder`, deterministic variant rotation. The voice lint fails on em dashes, emoji, exclamation spam, Title Case and banned words across all 165 entries |

The voice lint is 1,339 assertions over the registry, plus two cross-checks: no
entry nothing says, and no id the code asks for that does not exist.

---

## 3. Demo: shortest path in taps

**Before: 7.** Party, errand, category, place, amount, "that's enough", purpose.

**After: 6.** Party, errand, "Say it in one sentence", "Yes, that's it",
"that's enough", purpose. The one-sentence chip replaces the three-tap build of
a line with one tap.

Asserted in `e2e/demo.e2e.mjs`, which counts the taps and fails if the path
grows. The correction chip and the three side chips are off the shortest path
and counted separately.

The paste lesson is still not a tap, by design: it exists to show what pasting a
real message does.

---

## 4. Slang terms added, with sources

One extensible table, `SHENG_DENOMINATIONS` in `parsers/swahili.ts`. Values
verified in at least two independent sources before being added.

| Term | Value | Sources |
|---|---|---|
| kobole | 5 | Wikipedia, "Sheng slang"; The Standard, "10 old skul slang names for money" |
| ashuu | 10 | Wikipedia; The Standard |
| mbao | 20 | Wikipedia; The Standard; Kenyan Magazine |
| finje | 50 | Wikipedia; The Standard |
| chwani / chuani | 50 | Wikipedia (spells it "chuani"); The Standard |
| soo / so | 100 | Wikipedia (spells it "so"); The Standard; Lemon8 Kenya money-slang guide |
| rwabe | 200 | Wikipedia; The Standard |
| thao | 1,000 | Wikipedia; The Standard |
| ngiri | 1,000 | Wikipedia; The Standard |

"bob" for a shilling was verified separately (Lemon8 Kenya money-slang guide;
Wikipedia, "Shilling (British coin)", for the colonial origin) and was already
handled by the currency extractor, so no table entry was needed.

**Deliberately not added, despite being attested: "punch" (500).** It is an
ordinary English noun and a plausible thing to buy. A table entry turning
"bought punch for 200" into 500 would be worse than not knowing the word.

Compound forms work through the existing machinery rather than a second one:
"soo mbili" is rewritten to "2 soo" exactly as "elfu tatu" is rewritten to
"3 elfu", and the multiplier table does the rest. A bare denomination word is
only read as money when the message contains no other figure, because "mbao" is
also Swahili for timber and "bought mbao for 500" must stay five hundred
shillings of boards.

Sources:
[Sheng slang (Wikipedia)](https://en.wikipedia.org/wiki/Sheng_slang) ·
[10 old skul slang names for money (The Standard)](https://www.standardmedia.co.ke/entertainment/county-nairobi/article/2000177467/10-old-skul-slang-names-for-money) ·
[Sheng words for money (Kenyan Magazine)](https://kenyanmagazine.co.ke/sheng-words-for-money/) ·
[Kenya Swahili money slang (Lemon8)](https://www.lemon8-app.com/@faith_connect_fellowship/7523994821581636109?region=us) ·
[Shilling, British coin (Wikipedia)](https://en.wikipedia.org/wiki/Shilling_(British_coin))

---

## 5. Decision queue

Six entries in `DECISIONS.md`, none of them blocking:

- **D1. Who made M-Track** (I8). Ships an honest placeholder that declines to say.
- **D2. Crisis wording and helpline** (K4). Ships without a number. A helpline
  has to be verified against an official source and confirmed as operating; a
  dead number in that moment would be worse than none.
- **D3. Should a document print a time?** No surface prints one today, which is
  why nothing asks for one. What printing one would take is written down.
- **D4. Mirroring Swahili greetings.** Recommendation: leave it. A bot that says
  "Habari" and then conducts the rest in English makes a promise it does not keep.
- **D5. Weekly and category totals.** Both need a data-model change, so neither
  was built; "this week" answers the month exactly and says so.
- **D6. Copy still outside the registry.** The demo, the SMS-batch narration and
  the Active Mode walkthrough, with a proposal for linting them without a full
  migration.

---

## 6. Deviations from the spec

**The copy registry was built in Phase 0, not Phase 1.** Phase 0 was specified
as "no product changes", but its deliverable is a harness whose assertions are
on copy ids, and ids cannot be asserted before they exist. The registry was
therefore created in Phase 0 carrying today's wording verbatim, so the baseline
measures the bot as it shipped, and Phase 1 rewrote the copy. Behaviour was
unchanged across Phase 0: all 647 pre-existing unit tests and all seven e2e
suites passed.

**Extracting the conversation engine was also Phase 0 work.** The spec says the
harness must drive the production composition path. There was no production path
to call: the routing was ~600 lines of React callbacks inside `ChatScreen.tsx`.
Extracting it to `lib/conversation/engine.ts` was the precondition for the
harness, not a product change, and it is verified by the full suite passing
across the move.

**Three sets of copy are not in the registry.** The guided demo, the SMS-batch
narration (`parseNotices.ts`, `insights/generators.ts`) and the Active Mode
walkthrough. Reasons and a proposal are in `DECISIONS.md` D6. The narration in
particular is a generator, not a table: its sentences are assembled from counts
and figures, so "move it into the registry" is not a migration but a rewrite.

**Three scenario expectations were changed.** B1, B3 and C3, each because the
expectation was wrong about the flow rather than the flow being wrong about the
conversation. All three are recorded with their reasons in the change log at the
foot of `CONVERSATION_SCOREBOARD.md`. No scenario was made to pass by weakening
an assertion; where the catalogue's wording turned out to describe two equally
good behaviours (D5, E2, J10), the assertion was widened to the honest set with
a written reason in the scenario itself.

**Section M has one scenario, not three.** M1 (returning mid-draft) and M2
(returning the next day) are mount-time effects in `ChatScreen`, outside the
engine, so the harness cannot drive them. Both behaviours exist and are
unchanged; they are covered by the journey e2e and by the resume copy, but they
are not in the catalogue and I have not pretended otherwise.

---

## 7. An honest assessment of what still escapes the harness

The scoreboard says 110 of 110, and that number is worth exactly as much as the
catalogue behind it. Here is what it does not cover.

### Kinds of user behaviour not modelled at all

**Ambiguity that needs the world, not the sentence.** "I paid Mama Njeri 500" —
is that a person, a kiosk, or a nickname for a supplier? The bot files it as a
payee and moves on. Nothing in the catalogue asks what happens when it is wrong,
because there is no correct answer available from the text.

**Long, rambling, genuinely mixed messages.** Every catalogue message is at most
two clauses. Real messages run to five, switch tense, drop half a sentence and
resume it. `segmentMultiIntent` splits on a small set of discourse markers and
nothing else; a message with three purchases, a question and a complaint in one
paragraph will have some of it silently dropped. The harness cannot tell me how
much, because I wrote the messages.

**Conversations longer than six turns.** The longest scenario is nine steps. I
have no evidence about what a forty-turn session feels like, and the two pieces
of state most likely to misbehave over that length — the variant cursor and the
off-topic streak — are only exercised across a handful of turns.

**Returning after a real interruption.** A phone call, a day, a browser tab
discarded mid-draft. Section M is one scenario, and the two that matter most
cannot be driven by the harness at all.

**Anyone who is not fluent in written English.** Input is read in English,
Swahili and common Sheng, and every reply is English. The whole catalogue is
written in the English I would type. A user who writes mostly in Swahili will
hit the honest fallback far more often than any scenario here suggests, and
`DECISIONS.md` D4 explains why a Swahili greeting does not paper over that.

**Typing on a phone, at speed, while distracted.** Typos are covered by a fuzzy
pass and merged-word tolerance, but the catalogue's typos are ones I chose. Real
ones cluster differently, and the "I couldn't pick anything out of that" rate on
a real device is unknown.

### Things the harness checks less well than it appears to

**`echoes` is a substring match.** It proves a string is present, not that the
sentence reads well. "Ksh 3,100 to Bacon" passed `echoes('3,100')` for the whole
of Phase 2 and was still wrong English; it took reading the transcripts to catch
it, which is exactly why the critique loop exists and why it found things the
2,212 assertions did not.

**`endsWithNextStep` accepts a verb from a list.** A reply containing the word
"tap" anywhere near the end passes. It would not catch a next step that is
present but useless.

**The edge classifier is nineteen regex families.** Every one of them can be
evaded by a phrasing I did not think of, and every one can fire on a sentence I
did not anticipate. The precedence rule that protects real data is tested in
both directions on the one case I know matters — tense — and on no other.

**Crisis detection is the highest-stakes thing here and the least testable.**
The conservative triggers are proven not to fire on four colloquialisms. They
are not proven to fire on a real person's words, because I do not have those,
and I would not want a scoreboard to imply otherwise.

### The honest summary

Inside the lane, the bot now listens: it does not ask for what it was given, it
says things back in the user's own words, it corrects in one turn, and it ends
every turn with somewhere to go. At the edge it says plainly what it is and
steers back, and it does not claim a capability it lacks.

What I cannot tell you is how it behaves on a message no one has written yet.
The catalogue is a floor. It was a floor at 25 of 104 and it is a floor at 110
of 110, and the next real transcript from a real phone is worth more than any
number in this file.
