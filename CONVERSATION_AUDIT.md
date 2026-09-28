# Conversation audit (Phase 0 baseline)

Taken before any behaviour changed, so the scoreboard below measures the bot as
it shipped, not as it is being rebuilt.

## Where bot copy lived

Before this pass, every sentence the chat said was a literal at its point of
use. There were five separate homes for it and no way to check any of them:

| Where | What lived there |
|---|---|
| `ChatScreen.tsx` | ~40 module constants (`GREETING`, `MODE_QUESTION`, `DATE_PROMPT`, `EFFICIENCY_NUDGE`, all the `DEMO_*`) plus a dozen literals inlined in handlers |
| `conversationalCapture.ts` | the confirmation sentence, the mixed-currency question, the assumed-currency note |
| `metaAnswers.ts` | seven answers to questions about the app |
| `partyQuestion.ts` | eight party-slot wordings and four placeholders |
| `zeroUnderstanding.ts` | two fallbacks and three escape-option labels |
| `metaIntent.ts` | the cancel confirmation and its two option labels |
| `correction.ts` | two "I could not work that out" sentences |
| `parseNotices.ts`, `insights/generators.ts` | the SMS-batch narration |

## Where it lives now

`src/lib/conversation/copy.ts` — **75 entries**, each with a stable id, a kind
(question, acknowledgement, confirmation, help, redirect, terminal, statement,
option) and one or more variants. Everything the chat conversation says comes
from there. `partyQuestion.ts`, `metaAnswers.ts`, `zeroUnderstanding.ts`,
`metaIntent.ts` and `correction.ts` now decide *which* entry applies and hold no
wording of their own.

Not yet migrated, and why:

- **the guided demo** (`demoFlow.ts` and the `DEMO_*` constants) — Phase 7 rebuilds
  the demo, and migrating its copy twice would be churn for no gain.
- **`parseNotices.ts` and `insights/generators.ts`** — the SMS-batch narration.
  These are generators, not a copy table: the sentence is assembled from figures
  and counts. They are covered by a separate lint for banned words and em dashes
  rather than by a full migration. Recorded as a deviation in the final report.
- **Active Mode walkthrough** — a different surface, out of this pass's scope.

## The structural change

The conversation itself is no longer inside a React component.

`ChatScreen.tsx` held ~600 lines of routing across `handleDocFlow`,
`handleDescription`, `askNextField`, `advanceAfterField` and `commitDraft`, all
closing over `addMessage` and `setDocFlow`. The only way to exercise any of it
was to render a chat, so nothing did — the existing conversational tests called
the composition helpers directly and modelled the routing by hand. That is the
exact mistake this project has already made once, with the slot-filling suite.

That logic now lives in `src/lib/conversation/engine.ts` as `receive(state, text,
ctx) -> { state, turns, effects }`. `ChatScreen` is an adapter: it turns
`BotTurn`s into chat messages and `Effect`s into the things only a component can
do (parse a batch, add a receipt card, persist a draft). The scenario harness
drives the same `receive`. There is one implementation.

Verified non-vacuously: all 647 pre-existing unit tests and all 7 e2e suites
(184 checks) pass unchanged across the extraction, including the full chat
journey and capture replays.

## Baseline

**25 of 104 catalogue scenarios pass.** Run across the document types each path
applies to, that is 220 scenario runs.

| Section | Scenarios | Passing |
|---|---|---|
| A. Opening and mode choice | 9 | 1 |
| B. Capture | 19 | 8 |
| C. Clarifying questions | 8 | 3 |
| D. Enrichment | 7 | 0 |
| E. Confirmation | 9 | 1 |
| F. After saving | 5 | 2 |
| G. Corrections mid-flow | 3 | 1 |
| H. Cancel and restart | 3 | 3 |
| I. Help and meta questions | 10 | 0 |
| J. Off-topic and out of scope | 13 | 1 |
| K. Emotional content | 5 | 1 |
| L. Input robustness | 6 | 3 |
| M. Session and return | 1 | 1 |
| N. Spending questions | 3 | 0 |

The shape of it: the bot is competent at the middle of its own lane (cancel,
currency locking, itemisation, batched slots, resuming after an interruption)
and has almost nothing at either end. It cannot start a conversation any way but
by tapping, and at the edge it has no honest answer for privacy, identity,
capability requests, advice, small talk, emotion or off-topic — every one of
those currently falls into either "tap one of the options above" or "I couldn't
pick anything out of that".

Per-scenario detail is in `CONVERSATION_SCOREBOARD.md`; the actual rendered
conversations are in `CONVERSATION_TRANSCRIPTS.md`.
