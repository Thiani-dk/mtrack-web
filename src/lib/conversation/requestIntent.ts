// Things the user asks the app to DO, rather than things they tell it.
//
// Each of these used to fall through to "I couldn't pick anything out of that",
// which is both untrue and unhelpful: the message was perfectly clear, and the
// honest answer is either where to go or what this cannot do.

// "Undo", "delete that". Removing a saved document is not something this chat
// does, so the honest answer is where it IS done.
const UNDO_RE =
    /^(?:undo|undo that|delete (?:that|it|this|the (?:last|document|receipt))|remove (?:that|it|the (?:last|document|receipt))|cancel that one|take that back|scrap that one)\b/i;

// "Send it to my boss". M-Track cannot send anything. What exists is Share and
// Save, and saying so beats implying a send that will never happen.
const SEND_RE =
    /\b(?:send|email|e-mail|mail|whatsapp|forward|text) (?:it|this|that|the (?:receipt|document|claim|summary))\b|\bsend (?:it )?to (?:my|the)\b/i;

// "Make it a PDF", "download it".
const EXPORT_RE =
    /\b(?:make|turn|save|export|download|print)\s+(?:it|this|that)?\s*(?:into|to)?\s*(?:a|an)?\s*(?:pdf|web page|html|file|document)\b|\bas a pdf\b|\bpdf (?:please|version)\b|\bdownload (?:it|this|that)\b/i;

// "Another one", "new receipt". A fresh capture, same mode.
const ANOTHER_RE =
    /^(?:another(?: one)?|one more|next one|new (?:one|receipt|record|document|claim)|add another|again)\b[\s.!?]*$/i;

// "Start over". Distinct from "another one": this abandons what is in hand.
const START_OVER_RE = /^(?:start over|start again|restart|begin again|from the top)\b[\s.!?]*$/i;

export type RequestIntent = 'undo' | 'send' | 'export' | 'another' | 'start-over' | null;

// What the message is asking for, or null. Order is precedence: "delete that
// and start over" is a deletion request first, because that is the part this
// has to be honest about.
export function readRequest(text: string): RequestIntent {
    const t = text.trim();
    if (UNDO_RE.test(t)) return 'undo';
    if (SEND_RE.test(t)) return 'send';
    if (EXPORT_RE.test(t)) return 'export';
    if (START_OVER_RE.test(t)) return 'start-over';
    if (ANOTHER_RE.test(t)) return 'another';
    return null;
}

// ── Asking for help with the question in hand ───────────────────────────────

// "Like what?", "give me an example". Not a question about the app, a question
// about the question, and it deserves one example rather than the answer bank.
const EXAMPLE_RE =
    /^(?:like what|such as|for example|eg|e\.g\.?|example|an example|give me an example|what do you mean|how do you mean|what kind|what sort|meaning)\b[\s?.!]*$/i;

export function asksForExample(text: string): boolean {
    return EXAMPLE_RE.test(text.trim());
}

// "I don't know", "not sure", "skip". A real answer to a question, and a
// different one from silence: it says the user cannot supply this.
const DONT_KNOW_RE =
    /^(?:i )?(?:don'?t|do not|dont) know\b|^not sure\b|^no idea\b|^can'?t remember\b|^i forget\b|^i forgot\b|^unsure\b|^dunno\b|^sijui\b|^skip\b|^pass\b|^leave it\b|^n\/?a$/i;

export function saysDontKnow(text: string): boolean {
    return DONT_KNOW_RE.test(text.trim());
}
