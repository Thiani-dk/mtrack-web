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
            "I'm M-Track. Copy your M-Pesa, Airtel Money, or any transaction confirmation messages "
            + "and send them here. I'll break down what you spent, spot patterns, and put together "
            + 'a receipt you can download.',
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
        kind: 'question',
        variants: [
            'Picking up where we left off. Edit anything on the document, or tap Approve when it looks right.',
        ],
    },
    'open.tapOne': {
        kind: 'question',
        variants: ["Tap one of the options above so I know what we're making."],
    },

    // Mode prompts
    'mode.ownPrompt': {
        kind: 'question',
        variants: [
            "Copy your M-Pesa, Airtel Money, or bank messages in. If you don't have the message "
            + 'for something, just tell me what you spent and when.',
        ],
    },
    'mode.posName': { kind: 'question', variants: ["What's the business name?"] },
    'mode.posItem': {
        kind: 'question',
        variants: [
            'Now tell me what they bought and the amount. You can paste the M-Pesa message instead if you have it.',
        ],
    },
    'mode.oboParty': { kind: 'question', variants: ['Who was this for?'] },
    'mode.oboPurpose': {
        kind: 'question',
        variants: ["What was it for? Say skip if you'd rather leave that out."],
    },
    'mode.oboInput': {
        kind: 'question',
        variants: ['Copy the M-Pesa messages, or tell me what you spent and when.'],
    },

    // Slot questions
    'ask.date': {
        kind: 'question',
        variants: ["When was that? A rough date is fine, but I'd rather leave it blank than guess."],
    },
    'ask.amount': { kind: 'question', variants: ['How much was it?'] },
    'ask.amountRetry': { kind: 'question', variants: ['How much was it? A figure is enough.'] },
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
        variants: ["You've got {summary} down already \u2014 scrap the whole thing, or stop here and keep it?"],
    },
    'cancel.option.discard': { kind: 'option', variants: ['Discard everything'] },
    'cancel.option.keep': { kind: 'option', variants: ['Keep what I have'] },
    'cancel.discarded': { kind: 'terminal', variants: ['Scrapped, all of it. Nothing was saved.'] },
    'cancel.tapOne': { kind: 'question', variants: ['Tap one of the two above and I will do that.'] },

    // Not understood
    'zero.ask1': {
        kind: 'question',
        variants: [
            "I couldn't pick anything out of that. Could you tell me what you bought and how much, "
            + "one thing at a time? Like: 'bought bacon for 3100.'",
        ],
    },
    'zero.ask2': {
        kind: 'question',
        variants: [
            'Still not landing, sorry. One thing at a time might help. What did you spend money on, '
            + 'and how much was it?',
        ],
    },
    'zero.escape': {
        kind: 'question',
        variants: ["I'm not getting there by asking, so let's try something else."],
    },
    'zero.option.paste': { kind: 'option', variants: ['Paste the message instead'] },
    'zero.option.skip': { kind: 'option', variants: ['Skip this one'] },
    'zero.option.restart': { kind: 'option', variants: ['Start over'] },
    'zero.pasteReady': {
        kind: 'question',
        variants: ['Go ahead \u2014 paste the M-PESA message itself and I will read it from there.'],
    },
    'zero.cleared': { kind: 'question', variants: ['Cleared. What did you spend on?'] },
    'zero.tapOne': {
        kind: 'question',
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
        kind: 'question',
        variants: ['Tap one of the items above and tell me the new figure.'],
    },

    // Answers to questions about the app itself. Small and fixed on purpose: a
    // question the bank does not cover gets help.unknown rather than an
    // improvised answer. This is a tool that files financial records, and
    // inventing a capability it does not have is worse than admitting the gap.
    'help.currency': {
        kind: 'help',
        variants: [
            "Kenyan Shillings by default, but I'll lock onto whatever you mention \u2014 USD, EUR, "
            + 'GBP, TZS, UGX, RWF. Whichever you name first holds for the whole record.',
        ],
    },
    'help.remove': {
        kind: 'help',
        variants: [
            'Tell me which one and what it should be, or say "scratch that" \u2014 and when the '
            + 'receipt is on screen you can leave a line out of it before approving.',
        ],
    },
    'help.edit': {
        kind: 'help',
        variants: [
            'Just say what\'s wrong \u2014 "actually the bacon was 3500" \u2014 and I\'ll change '
            + 'that one and show you what moved.',
        ],
    },
    'help.paste': {
        kind: 'help',
        variants: [
            "Paste an M-PESA message straight in and I'll read the amount, the date and who it "
            + 'went to out of it. The Paste button next to the message box does it in one tap.',
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
            'Anything readable works \u2014 "yesterday", "last Friday", "4 May". I\'ll say back '
            + "how I read it, and I'd rather leave it blank than guess.",
        ],
    },
    'help.unknown': {
        kind: 'help',
        variants: ["I don't have a good answer for that one, sorry."],
    },

    // Meta questions
    'meta.answerAndResume': { kind: 'help', variants: ['{answer} Anyway \u2014 {question}'] },
    'meta.answerAfterData': { kind: 'help', variants: ['To answer your question: {answer}'] },

    // Committing a line
    'commit.added': {
        kind: 'question',
        variants: ['Added. Tell me the next one, or tap Approve when the document looks right.'],
    },
    'commit.addedDirection': {
        kind: 'question',
        variants: ['Added. Set which way that one went above, then tell me the next.'],
    },
    // Purpose labelling (on_behalf_of)
    'purpose.ask': {
        kind: 'question',
        variants: ['What was the {amount} to {party} for? Say skip to leave it out.'],
    },
    'purpose.done': {
        kind: 'question',
        variants: ["That's every line explained. Tap Approve when the document looks right."],
    },

    // Saving
    'approve.saved': { kind: 'terminal', variants: ['Approved and saved. It is in your history now.'] },
    'system.error': {
        kind: 'statement',
        variants: [
            'Something went wrong while I was working on that. Nothing was lost \u2014 try sending it again.',
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
