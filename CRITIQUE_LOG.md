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
