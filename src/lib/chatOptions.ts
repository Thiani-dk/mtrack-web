import type { ChatMessage } from '../types';

// Typed answers to tappable questions.
//
// Buttons stay the primary interaction — this is a mobile-first app — but a
// question that shows "Skip" should also accept someone typing "skip" and
// hitting send. Implemented once against the message list rather than per
// question: the 'options' kind is data-driven, so any question added later
// using it gets this for free.

export interface TypedChoice {
    messageId: string;
    kind: ChatMessage['kind'];
    label: string;
    value: string;
    // Extra the tap handler needs, for the two bespoke question kinds.
    transactionCode?: string;
}

// The tappable choices a message offers, whatever its kind. An already-answered
// question offers none — its buttons are locked, so typing at it shouldn't work
// either.
export function choicesFor(m: ChatMessage): TypedChoice[] {
    if (m.answered) return [];
    switch (m.kind) {
        case 'options':
            return (m.options ?? []).map(o => ({
                messageId: m.id, kind: m.kind, label: o.label, value: o.value,
            }));
        // The two kinds with fixed, built-in buttons declare them here so there
        // is still one list to consult, not a special case per question. These
        // labels must match the button text in ChatNearDuplicate /
        // ChatDirectionQuestion.
        case 'near-duplicate':
            if (!m.nearDuplicatePair) return [];
            return [
                { messageId: m.id, kind: m.kind, label: 'Keep both', value: 'keep' },
                {
                    messageId: m.id, kind: m.kind, label: 'Drop the small one', value: 'drop',
                    transactionCode: m.nearDuplicatePair.smaller.transactionCode,
                },
            ];
        case 'direction-question':
            if (!m.directionQuestion) return [];
            return [
                {
                    messageId: m.id, kind: m.kind, label: 'Money out', value: 'sent',
                    transactionCode: m.directionQuestion.transactionCode,
                },
                {
                    messageId: m.id, kind: m.kind, label: 'Money in', value: 'received',
                    transactionCode: m.directionQuestion.transactionCode,
                },
            ];
        default:
            return [];
    }
}

// Match typed text against the most recent unanswered question's labels.
//
// Full labels only, case-insensitive and trimmed. Deliberately no partial-word
// matching and no single-letter shortcuts: a phone keyboard doesn't reward
// them, and a loose match would hijack ordinary messages. No match means null,
// and the caller carries on with normal conversational handling rather than
// guessing at what was meant.
export function matchTypedAnswer(messages: ChatMessage[], text: string): TypedChoice | null {
    const typed = text.trim().toLowerCase();
    if (!typed) return null;
    for (let i = messages.length - 1; i >= 0; i--) {
        const choices = choicesFor(messages[i]);
        if (choices.length === 0) continue;
        return choices.find(c => c.label.trim().toLowerCase() === typed) ?? null;
    }
    return null;
}
