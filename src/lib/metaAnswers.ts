// Answers to questions about the app itself.
//
// Small and fixed on purpose. A question the bank does not cover gets a plain
// "I don't know that one" rather than an improvised answer — this is a tool
// that files financial records, and inventing a capability it does not have is
// worse than admitting the gap.
//
// Every answer is one or two sentences, because it is interrupting something:
// the user asked mid-capture and wants to get back to what they were doing.

interface MetaAnswer {
    match: RegExp;
    text: string;
}

const ANSWERS: MetaAnswer[] = [
    {
        match: /\bcurrenc/i,
        text: "Kenyan Shillings by default, but I'll lock onto whatever you mention — USD, EUR, GBP, "
            + "TZS, UGX, RWF. Whichever you name first holds for the whole record.",
    },
    {
        match: /\b(?:delete|remove|get rid of|take out)\b/i,
        text: 'Tell me which one and what it should be, or say "scratch that" — and when the receipt '
            + 'is on screen you can leave a line out of it before approving.',
    },
    {
        match: /\b(?:edit|change|fix|correct)\b/i,
        text: 'Just say what\'s wrong — "actually the bacon was 3500" — and I\'ll change that one '
            + 'and show you what moved.',
    },
    {
        match: /\b(?:paste|sms|message|mpesa|m-pesa)\b/i,
        text: "Paste an M-PESA message straight in and I'll read the amount, the date and who it "
            + 'went to out of it. The Paste button next to the message box does it in one tap.',
    },
    {
        match: /\b(?:pdf|export|download|share|save)\b/i,
        text: 'Once a receipt is approved you can save it as a PDF or a web page, or share it '
            + 'straight from here.',
    },
    {
        match: /\b(?:how does (?:this|it) work|what is this|what do you do|what can you do)\b/i,
        text: 'Tell me what you spent and when, in your own words, and I turn it into a receipt or '
            + 'an expense summary you can save or send.',
    },
    {
        match: /\b(?:date|when)\b/i,
        text: "Anything readable works — \"yesterday\", \"last Friday\", \"4 May\". I'll say back how I "
            + "read it, and I'd rather leave it blank than guess.",
    },
];

// The answer to a question about the system, or null if there isn't one.
export function answerMetaQuestion(question: string): string | null {
    return ANSWERS.find(a => a.match.test(question))?.text ?? null;
}

// The same, with an honest fallback — for callers that must say something.
export function answerOrAdmit(question: string): string {
    return answerMetaQuestion(question)
        ?? "I don't have a good answer for that one, sorry.";
}
