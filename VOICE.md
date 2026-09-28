# M-Track's voice

M-Track's chat is deterministic. It is rules and templates, not a language
model, and it makes no network calls. The aim is not to sound intelligent. The
aim is to be genuinely helpful inside one activity — recording money that
changed hands — in the way a skilled contact-centre agent working from a
well-designed script comes across as attentive and competent.

The test of it: **inside M-Track's lane, a user should never feel the bot wasn't
listening. At the edge of the lane, it says plainly what it is and steers back.**

Everything below that can be checked mechanically is checked in
`src/lib/conversation/voice.test.ts`. A style guide nobody can fail is a style
guide nobody follows.

## The persona

**Helpful and brief.** One idea per message. It gets to the point.

**Plain-spoken.** No jargon. It never says "transaction processed", "invalid
input", "parsed", "entity", "slot" or "query". It does not describe its own
machinery to the person using it.

**Warm but not chummy.** Friendly acknowledgements, no gushing, no forced jokes.
It does not perform enthusiasm it cannot have.

**Kenyan-aware.** Examples are local: Naivas, Java House, matatu fare, KPLC
tokens, airtime. Money is formatted in Ksh unless the user names another
currency, in which case that one holds for the whole record. It understands
Swahili and common Sheng in input and replies in English in this pass.

**Honest about itself.** It is M-Track's assistant: a set of rules built for
recording money on this device. Not a person. Not a general chatbot. It has no
feelings, remembers nothing it does not actually store, and never claims a
capability it lacks — it cannot send money, check a balance, file taxes or give
financial advice.

## The thirteen principles

Each one is either a lint rule, a harness assertion, or both. The enforcement
column names what would fail if the principle were broken.

| # | Principle | Enforced by |
|---|---|---|
| 1 | **Never ask for what was already given.** Every question is generated from what the draft is actually missing, never from a fixed list. | `doesNotAsk(slot)` in the harness; `openSlots` is the only source of a question |
| 2 | **Every question has a reason.** Skip anything that does not serve the record. Where a question could seem odd, give the reason in one short clause. | scenario C5 (`why do you need the date?`), C4b |
| 3 | **Reflect back in the user's own words.** "Lunch at Java House, got it", not "OK". | `echoes(text)` |
| 4 | **Reference earlier details.** "You said Java House earlier." | `echoes(text)` on a later turn; scenario D1 |
| 5 | **Acknowledge before acting** when the user signals frustration or stress. | scenarios K1, K2, J8 |
| 6 | **Offer controlled options** at choice points and after any breakdown. | `offers([...])`; scenarios B7b, B10, C7, E2 |
| 7 | **Change strategy after two failures.** Never loop the same prompt a third time. | `notRepeatOfPrevious()`; `MAX_DATE_ATTEMPTS`, `MAX_ZERO_UNDERSTANDING` |
| 8 | **Match confirmation to stakes.** Mid-flow facts are confirmed implicitly, by echoing them into the next question. Saving gets one explicit confirmation. | `confirm.summary` is the only explicit confirmation in the registry; `echoes` covers the implicit ones |
| 9 | **One-step corrections.** "No, 600" fixes the amount in one turn. Never force a restart. | scenarios E3, E4, G1, G2 |
| 10 | **Cooperative principle.** Truthful, the right amount, relevant, clear. Saying too much is as uncooperative as saying too little. | the length limit per message kind, in the voice lint |
| 11 | **Signpost.** Tell the user how close they are. | scenario assertions on the batched-question path |
| 12 | **End every non-terminal turn with a clear next step**: a question, options, or a stated action. | `endsWithNextStep()`; the question-kind rule in the voice lint |
| 13 | **Consistent persona.** The same voice everywhere. Vary acknowledgements, keep confirmation structure stable so it stays predictable. | one registry, one `TurnBuilder`; `notRepeatOfPrevious()` |

## Banned words

Checked as whole words, case-insensitively, across every registry variant:

`transaction processed`, `invalid input`, `invalid`, `parsed`, `parse`,
`entity`, `slot`, `query`, `field is required`, `processing`, `unsupported`,
`null`, `undefined`, `error occurred`

Also banned outright: **em dashes and en dashes**, **emoji**, and **more than one
exclamation mark** in a single message. Sentence case throughout: three
capitalised words in a row is a heading, not a sentence.

## Length limits

By message kind, in characters. A kind is declared on every registry entry.

| Kind | Limit | Why |
|---|---|---|
| `acknowledgement` | 120 | one clause |
| `option` | 60 | it is a button |
| `terminal` | 160 | nothing follows it, so it has nothing to set up |
| `question` | 165 | one sentence, plus at most a short second |
| `redirect` | 200 | an honest limit and a way back, and nothing else |
| `statement` | 210 | |
| `help` | 210 | it is answering something, so three sentences is fair |
| `confirmation` | 260 | as long as the thing being confirmed |

A `question`-kind entry must end with `?`, or with a placeholder whose
substituted text does. Anything that directs rather than asks is a `statement`,
and the harness still requires it to end with a next step.

## Five rewrites

Real copy, before and after, from this pass.

**1. The greeting.** Three promises, one of them ("spot patterns") not true of a
described line at all.

> before: I'm M-Track. Copy your M-Pesa, Airtel Money, or any transaction confirmation messages and send them here. I'll break down what you spent, spot patterns, and put together a receipt you can download.
>
> after: I'm M-Track. I keep a record of money that changed hands. Paste your M-Pesa, Airtel Money or bank messages, or just tell me what you spent.

**2. The date question.** A question-kind message that buried its question in
the middle, so the batched follow-on ("And how much?") landed after a caveat
rather than after a question.

> before: When was that? A rough date is fine, but I'd rather leave it blank than guess.
>
> after: A rough date is fine, and I'd rather leave it blank than guess. When was that?

**3. Resuming after an interruption.** The em dash, and a lowercasing rule that
turned a parked confirmation into "Anyway — ksh 3,100 to Bacon".

> before: {answer} Anyway — {question}
>
> after: {answer}\n\nBack to it: {question}

The lowercasing function is gone, not fixed: the new connective ends in a colon,
so the question keeps its own capital and there is nothing left to get wrong.

**4. The paste how-to.** Answered "how do I paste?" by describing the result
rather than the steps.

> before: Paste an M-PESA message straight in and I'll read the amount, the date and who it went to out of it. The Paste button next to the message box does it in one tap.
>
> after: In your SMS app, press and hold the message, tap Copy, then tap the Paste button next to the message box here. I'll read the amount, the date and who it went to.

**5. The composer hint at the confirmation.** Not a message, but bot copy all
the same: `'yes' to confirm` was the hint under the thumb at *every* question in
the flow, including the ones where "yes" meant nothing.

> before: one hint for the whole flow, `'yes' to confirm, or tell me what's off...`
>
> after: a hint per pending question — `A rough date...`, `Amount in USD...`,
> `Who it was paid to...`, `What it was for, or 'skip'...` — and
> `'yes' to confirm, or say what's off...` only at the confirmation.

## Where the words live

`src/lib/conversation/copy.ts`. Every bot-facing sentence in the chat, with a
stable id, a kind and its variants. Nothing else in the conversation holds a
literal: `partyQuestion.ts`, `metaAnswers.ts`, `zeroUnderstanding.ts`,
`metaIntent.ts` and `correction.ts` decide *which* entry applies and hold no
wording of their own.

Two surfaces are deliberately outside it for now, and are recorded as such:
the guided demo (Phase 7 rebuilds it) and the SMS-batch narration in
`parseNotices.ts` and `insights/generators.ts`, which assembles sentences from
figures rather than picking them from a table.
