// The one place every bot-facing sentence in the chat lives.
//
// Before this, copy was scattered across ChatScreen.tsx (forty-odd module
// constants and a dozen inline literals), conversationalCapture.ts,
// metaAnswers.ts, partyQuestion.ts and zeroUnderstanding.ts. Nothing could
// check the voice, nothing could vary a line without a code change, and the
// same idea was worded three different ways in three files.
//
// Every entry carries:
//   - a stable id, which is what tests assert on (wording may change, ids may
//     not),
//   - a kind, which decides the length limit and the shape rules the voice
//     lint applies,
//   - one or more variants. A second variant exists so a line the user may
//     hear twice in a row does not arrive word for word identical; see
//     TurnBuilder.say, which rotates rather than randomises so a transcript
//     is reproducible.
//
// Placeholders are {braced}. They are filled by `render`, and the voice lint
// reads the raw template — a placeholder never carries an em dash or an
// exclamation mark of its own.

export type CopyKind =
    | 'question'
    | 'acknowledgement'
    | 'confirmation'
    | 'help'
    | 'redirect'
    | 'terminal'
    | 'statement'
    | 'option';

export interface CopyEntry {
    kind: CopyKind;
    variants: readonly string[];
}

export type CopyParams = Record<string, string | number>;

// ── The registry ────────────────────────────────────────────────────────────

export const COPY = {
    // Opening and mode choice
    'open.greeting': {
        kind: 'statement',
        variants: [
            "I'm M-Track. I keep a record of money that changed hands. Paste your M-Pesa, "
            + 'Airtel Money or bank messages, or just tell me what you spent.',
        ],
    },
    'open.modeQuestion': {
        kind: 'question',
        variants: [
            'What are we putting together? Your own spending, a receipt for a customer, '
            + 'or money you spent for someone else?',
        ],
    },
    'open.mode.own': { kind: 'option', variants: ['My own spending'] },
    'open.mode.own.sub': { kind: 'option', variants: ['Copy your messages, or describe what you spent'] },
    'open.mode.pos': { kind: 'option', variants: ['A receipt for a customer'] },
    'open.mode.pos.sub': { kind: 'option', variants: ['Proof of purchase you hand over'] },
    'open.mode.obo': { kind: 'option', variants: ['Money I spent for someone else'] },
    'open.mode.obo.sub': { kind: 'option', variants: ['So they can pay you back'] },
    'open.resume': {
        kind: 'statement',
        variants: ["Still here. Copy your messages whenever you're ready."],
    },
    'open.resumeDraft': {
        kind: 'statement',
        variants: [
            'Picking up where we left off. Edit anything on the document, or tap Approve when it looks right.',
        ],
    },
    'open.tapOne': {
        kind: 'statement',
        variants: ["Tap one of the options above so I know what we're making."],
    },

    // Mode prompts
    'mode.ownPrompt': {
        kind: 'statement',
        variants: [
            'Paste your M-Pesa, Airtel Money or bank messages. If you do not have the message for '
            + 'something, just tell me what you spent and when.',
        ],
    },
    'mode.posName': { kind: 'question', variants: ["What's the business name?"] },
    'mode.posItem': {
        kind: 'statement',
        variants: [
            'Now tell me what they bought and the amount. You can paste the M-Pesa message instead '
            + 'if you have it.',
        ],
    },
    'mode.oboParty': { kind: 'question', variants: ['Who was this for?'] },
    'mode.oboPurpose': {
        kind: 'question',
        variants: ["Say skip if you'd rather leave it out. What was it for?"],
    },
    'mode.oboInput': {
        kind: 'statement',
        variants: ['Paste the M-Pesa messages, or tell me what you spent and when.'],
    },

    // Slot questions
    'ask.date': {
        kind: 'question',
        variants: ["A rough date is fine, and I'd rather leave it blank than guess. When was that?"],
    },
    'ask.amount': { kind: 'question', variants: ['How much was it?'] },
    'ask.amountRetry': { kind: 'question', variants: ['A figure on its own is enough. How much was it?'] },
    'ask.party.expense_summary': {
        kind: 'question',
        variants: ['Who was it paid to?', 'Who did that one go to?'],
    },
    'ask.party.personal_note': {
        kind: 'question',
        variants: ['Who was it paid to?', 'Who did that one go to?'],
    },
    'ask.party.point_of_sale': {
        kind: 'question',
        variants: ['What did they buy?', 'What did they buy this time?'],
    },
    'ask.party.on_behalf_of': {
        kind: 'question',
        variants: ['Where was this spent?', 'Who did the money go to?'],
    },

    // The short follow-on form, when two open slots are asked in one breath.
    'follow.date': { kind: 'question', variants: ['And when was that?'] },
    'follow.amount': { kind: 'question', variants: ['And how much?'] },
    'follow.party.expense_summary': { kind: 'question', variants: ['And who was that to?'] },
    'follow.party.personal_note': { kind: 'question', variants: ['And who was that to?'] },
    'follow.party.point_of_sale': { kind: 'question', variants: ['And what did they buy?'] },
    'follow.party.on_behalf_of': { kind: 'question', variants: ['And where was it spent?'] },

    // Date handling
    'date.giveUp': {
        kind: 'statement',
        variants: [
            "Let's leave the date off this one rather than guess. You can tap it on the document to set it later.",
        ],
    },
    'date.oboAmbiguous': {
        kind: 'question',
        variants: [
            'That date could be read two ways, day first or month first. On a claim a wrong date '
            + 'can get the whole thing rejected, so which is it?',
        ],
    },
    'date.retry': { kind: 'question', variants: ['{reason}'] },
    'date.invalid': { kind: 'question', variants: ['{reason} When was it?'] },

    // Nudges and confirmation
    'nudge.efficiency': {
        kind: 'statement',
        variants: [
            "If you've got the M-Pesa messages for these, copy them in. They carry the exact date "
            + 'and reference number, which makes this much harder to argue with.',
        ],
    },
    'confirm.summary': { kind: 'confirmation', variants: ['{sentence}'] },
    'confirm.added': { kind: 'confirmation', variants: ['Added. {sentence}'] },
    'confirm.reject': {
        kind: 'question',
        variants: ["No problem, let's go through it. {question}"],
    },
    'confirm.mixedCurrency': { kind: 'question', variants: ['{question}'] },

    // Cancel
    'cancel.immediate': {
        kind: 'terminal',
        variants: ['No worries, scrapped. Say the word when you want to start one.'],
    },
    'cancel.confirm': {
        kind: 'question',
        variants: ["You've got {summary} down already. Scrap the whole thing, or keep it and stop here?"],
    },
    'cancel.option.discard': { kind: 'option', variants: ['Discard everything'] },
    'cancel.option.keep': { kind: 'option', variants: ['Keep what I have'] },
    'cancel.discarded': { kind: 'terminal', variants: ['Scrapped, all of it. Nothing was saved.'] },
    'cancel.tapOne': { kind: 'statement', variants: ['Tap one of the two above and I will do that.'] },

    // Not understood
    'zero.ask1': {
        kind: 'question',
        variants: [
            "I couldn't pick anything out of that. One thing at a time works best, like "
            + "'bought bacon for 3100'. What did you spend on, and how much?",
        ],
    },
    'zero.ask2': {
        kind: 'question',
        variants: [
            'Still not landing, sorry. What did you spend money on, and how much was it?',
        ],
    },
    'zero.escape': {
        kind: 'statement',
        variants: ["I'm not getting there by asking, so let's try something else."],
    },
    'zero.option.paste': { kind: 'option', variants: ['Paste the message instead'] },
    'zero.option.skip': { kind: 'option', variants: ['Skip this one'] },
    'zero.option.restart': { kind: 'option', variants: ['Start over'] },
    'zero.pasteReady': {
        kind: 'statement',
        variants: ['Go ahead. Paste the M-Pesa message itself and I will read it from there.'],
    },
    'zero.cleared': { kind: 'question', variants: ['Cleared. What did you spend on?'] },
    'zero.tapOne': {
        kind: 'statement',
        variants: ['Tap one of the options above and we will take it from there.'],
    },

    // Corrections
    'correction.applied': { kind: 'acknowledgement', variants: ['{echo}'] },
    'correction.ambiguous': { kind: 'question', variants: ['{question}'] },
    'correction.unresolved': {
        kind: 'question',
        variants: ["I can tell something needs changing but not what to. What should it be instead?"],
    },
    'correction.lostTarget': {
        kind: 'question',
        variants: ['I lost track of which one that was. Which item should change, and to what?'],
    },
    'correction.tapOne': {
        kind: 'statement',
        variants: ['Tap one of the items above and tell me the new figure.'],
    },

    // Answers to questions about the app itself. Small and fixed on purpose: a
    // question the bank does not cover gets help.unknown rather than an
    // improvised answer. This is a tool that files financial records, and
    // inventing a capability it does not have is worse than admitting the gap.
    'help.currency': {
        kind: 'help',
        variants: [
            "Kenyan Shillings by default. I'll follow whatever you name instead: USD, EUR, GBP, "
            + 'TZS, UGX or RWF. The first one you say holds for the whole record.',
        ],
    },
    'help.remove': {
        kind: 'help',
        variants: [
            'Tell me which one and what it should be. Once the document is on screen you can '
            + 'also leave a line out of it before approving.',
        ],
    },
    'help.edit': {
        kind: 'help',
        variants: [
            'Just say what is wrong, like "actually the bacon was 3500". I will change that one '
            + 'and show you what moved.',
        ],
    },
    'help.paste': {
        kind: 'help',
        variants: [
            'In your SMS app, press and hold the message, tap Copy, then tap the Paste button '
            + "next to the message box here. I'll read the amount, the date and who it went to.",
        ],
    },
    'help.export': {
        kind: 'help',
        variants: [
            'Once a receipt is approved you can save it as a PDF or a web page, or share it '
            + 'straight from here.',
        ],
    },
    'help.whatCanYouDo': {
        kind: 'help',
        variants: [
            'Tell me what you spent and when, in your own words, and I turn it into a receipt or '
            + 'an expense summary you can save or send.',
        ],
    },
    'help.date': {
        kind: 'help',
        variants: [
            'Anything readable works: "yesterday", "last Friday", "4 May". I will say back how '
            + "I read it, and I'd rather leave it blank than guess.",
        ],
    },
    'help.unknown': {
        kind: 'help',
        variants: ["I don't have a good answer for that one, sorry."],
    },

    // Meta questions
    'meta.answerAndResume': { kind: 'help', variants: ['{answer}\n\nBack to it: {question}'] },
    'meta.answerAfterData': { kind: 'help', variants: ['To answer your question: {answer}'] },

    // Committing a line
    'commit.added': {
        kind: 'statement',
        variants: [
            'Added. Tell me the next one, or tap Approve when the document looks right.',
            "That's on the document. Add another, or tap Approve when it looks right.",
        ],
    },
    'commit.addedDirection': {
        kind: 'statement',
        variants: ['Added. Set which way that one went above, then tell me the next.'],
    },
    // Purpose labelling (on_behalf_of)
    'purpose.ask': {
        kind: 'question',
        variants: ['Say skip to leave it out. What was the {amount} to {party} for?'],
    },
    'purpose.done': {
        kind: 'statement',
        variants: ["That's every line explained. Tap Approve when the document looks right."],
    },

    // Narrating a pasted batch
    'batch.leadIn': {
        kind: 'statement',
        variants: [
            "Here's what stood out.",
            'A few things I noticed.',
            'Worth knowing:',
            'Quick read on this lot:',
        ],
    },
    'batch.nothingFound': {
        kind: 'statement',
        variants: ['I could not find any transactions in that. Try pasting the full message from your SMS app.'],
    },
    'batch.nothingFoundFull': {
        kind: 'statement',
        variants: [
            'I could not find any transactions in that. Try pasting the full message from your SMS '
            + 'app, starting from the M-Pesa confirmation.',
        ],
    },
    'batch.documentReady': {
        kind: 'statement',
        variants: ['Here is the document. Check it over, edit anything, then tap Approve.'],
    },
    'batch.small': {
        kind: 'statement',
        variants: ['Only {count} transaction{plural} in there, but here is what I found.'],
    },
    'batch.nothingUnusual': {
        kind: 'statement',
        variants: ['All sorted. Nothing unusual this time, but here is your summary.'],
    },
    'batch.moreDirections': {
        kind: 'statement',
        variants: ['{count} more like that are marked on the document for you to set.'],
    },

    // Composer placeholders. The hint under the user's thumb is bot copy too:
    // it was telling people to type "'yes' to confirm" at questions that were
    // not the confirmation.
    'placeholder.tapOption': { kind: 'option', variants: ['Tap an option above...'] },
    'placeholder.correctionTarget': { kind: 'option', variants: ['Tap the one you meant...'] },
    'placeholder.businessName': { kind: 'option', variants: ['Business name...'] },
    'placeholder.partyName': { kind: 'option', variants: ['Who it was for...'] },
    'placeholder.purpose': { kind: 'option', variants: ["What it was for, or 'skip'..."] },
    'placeholder.date': { kind: 'option', variants: ['A rough date...'] },
    'placeholder.amount': { kind: 'option', variants: ['Amount...'] },
    'placeholder.amountIn': { kind: 'option', variants: ['Amount in {currency}...'] },
    'placeholder.party.expense_summary': { kind: 'option', variants: ['Who it was paid to...'] },
    'placeholder.party.personal_note': { kind: 'option', variants: ['Who it was paid to...'] },
    'placeholder.party.point_of_sale': { kind: 'option', variants: ['What they bought...'] },
    'placeholder.party.on_behalf_of': { kind: 'option', variants: ['Where it was spent...'] },
    'placeholder.confirm': { kind: 'option', variants: ["'yes' to confirm, or say what's off..."] },
    'placeholder.open': { kind: 'option', variants: ['Paste your messages, or say what you spent...'] },

    // Saving
    'approve.saved': { kind: 'terminal', variants: ['Approved and saved. It is in your history now.'] },
    'system.error': {
        kind: 'statement',
        variants: [
            'Something went wrong while I was working on that. Nothing was lost, try sending it again.',
        ],
    },
} as const satisfies Record<string, CopyEntry>;

export type CopyId = keyof typeof COPY;

const PLACEHOLDER_RE = /\{(\w+)\}/g;

// Fills {braced} placeholders. An unknown placeholder is left as it is rather
// than rendered as "undefined" in a sentence the user is asked to agree to.
export function render(template: string, params: CopyParams = {}): string {
    return template.replace(PLACEHOLDER_RE, (whole, key: string) =>
        (key in params ? String(params[key]) : whole));
}

export function copyEntry(id: CopyId): CopyEntry {
    return COPY[id] as CopyEntry;
}

// Every placeholder a template expects, for the lint's "is this id ever
// rendered with the params it needs?" check and for the transcript writer.
export function placeholdersOf(id: CopyId): string[] {
    const found = new Set<string>();
    for (const variant of copyEntry(id).variants) {
        for (const m of variant.matchAll(PLACEHOLDER_RE)) found.add(m[1]);
    }
    return [...found];
}

export const ALL_COPY_IDS = Object.keys(COPY) as CopyId[];
