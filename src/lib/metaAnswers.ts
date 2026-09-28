import type { CopyId } from './conversation/copy';

// Which answer a question about the app itself gets.
//
// Small and fixed on purpose. A question the bank does not cover gets a plain
// "I don't know that one" rather than an improvised answer — this is a tool
// that files financial records, and inventing a capability it does not have is
// worse than admitting the gap.
//
// The answers themselves are registry entries (help.*). This module owns the
// matching, which is the part worth testing; the words are checked by the
// voice lint along with every other bot-facing sentence.

interface MetaAnswer {
    match: RegExp;
    copyId: CopyId;
}

const ANSWERS: MetaAnswer[] = [
    { match: /\bcurrenc/i, copyId: 'help.currency' },
    { match: /\b(?:delete|remove|get rid of|take out)\b/i, copyId: 'help.remove' },
    { match: /\b(?:edit|change|fix|correct)\b/i, copyId: 'help.edit' },
    { match: /\b(?:paste|sms|message|mpesa|m-pesa)\b/i, copyId: 'help.paste' },
    { match: /\b(?:pdf|export|download|share|save)\b/i, copyId: 'help.export' },
    {
        match: /\b(?:how does (?:this|it) work|what is this|what do you do|what can you do)\b/i,
        copyId: 'help.whatCanYouDo',
    },
    { match: /\b(?:date|when)\b/i, copyId: 'help.date' },
];

// The registry id of the answer to a question about the system, or null if
// there isn't one.
export function answerMetaCopyId(question: string): CopyId | null {
    return ANSWERS.find(a => a.match.test(question))?.copyId ?? null;
}

// The same, with an honest fallback — for callers that must say something.
export function answerOrAdmitCopyId(question: string): CopyId {
    return answerMetaCopyId(question) ?? 'help.unknown';
}
