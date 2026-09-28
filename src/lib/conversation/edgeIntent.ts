// The edge of M-Track's lane.
//
// Everything here is a message the app cannot act on, and the whole design is
// about saying so without lying and without lecturing. Before this, every one
// of these fell into either "tap one of the options above" or "I couldn't pick
// anything out of that" — the first untrue, the second unhelpful, and both
// leaving the user to work out for themselves what this thing actually is.
//
// PRECEDENCE IS THE LOAD-BEARING PART, and it runs in exactly one direction: a
// real data message must never be stolen by an edge category. The test case
// that pins it is tense. "Sent 500 to Kevin" is a record of something that
// happened and has to be captured. "Send 500 to Kevin" is asking the app to
// move money, which it cannot do. One letter apart, and getting it wrong in
// either direction is bad: losing a real transaction, or cheerfully filing a
// request as an expense.

export type EdgeCategory =
    // Deliberately first, and deliberately hard to trigger.
    | 'crisis'
    // Asking the app to move, buy or check money.
    | 'capability'
    // Asking what to do with money, which is advice and is not offered.
    | 'advice'
    | 'privacy'
    | 'identity'
    | 'whoMadeYou'
    | 'coverage'
    | 'taxInvoice'
    | 'noConnection'
    | 'frustration'
    | 'moneyStress'
    | 'goodNews'
    | 'smallTalk'
    | 'entertainment'
    | 'otherApp'
    | 'personal'
    | 'language'
    | 'offTopic';

// ── Crisis, conservatively ──────────────────────────────────────────────────

// Explicit statements about self-harm, and nothing else.
//
// The failure mode to avoid is not missing one. It is firing on "this price is
// killing me", which would be both absurd and, for someone using a spending
// tracker on a hard day, insulting. Every phrase here names the speaker and an
// act against themselves; nothing is inferred from tone, from the word "die",
// or from despair on its own. See scenario K4b, which exists to prove the
// colloquial phrases stay out.
const CRISIS_RE =
    /\b(?:kill myself|killing myself|end my life|ending my life|take my own life|taking my own life|end it all|don'?t want to (?:live|be here|go on)|do not want to live|want to die|wanna die|suicidal|commit suicide|no reason to live|better off dead|harm myself|hurt myself)\b/i;

// Phrases that must never count, however they read. Checked first, so a
// message containing both a colloquialism and nothing else stays out.
const NOT_CRISIS_RE =
    /\b(?:killing me|kills me|killed me|dying (?:of|for) \w+|dying to|died|dead broke|to die for|you'?re killing me|my (?:phone|battery|laptop|charger) died)\b/i;

export function isCrisis(text: string): boolean {
    const t = text.trim();
    if (NOT_CRISIS_RE.test(t) && !CRISIS_RE.test(t)) return false;
    return CRISIS_RE.test(t);
}

// ── Asking the app to move money ────────────────────────────────────────────

// Present and imperative forms ONLY. The past forms are data and are absent
// from this list on purpose; see the note at the top of the file.
const MOVE_VERBS = 'send|sending|transfer|transferring|pay|paying|buy|buying|top ?up|topping ?up|lend|withdraw|withdrawing|deposit|depositing|load';
const CAPABILITY_RE = new RegExp(
    String.raw`^\s*(?:please\s+)?(?:can you|could you|would you|will you|i want you to|i need you to)?\s*(?:${MOVE_VERBS})\b`
    + String.raw`|\b(?:can|could|will|would) you (?:${MOVE_VERBS})\b`
    + String.raw`|\bcheck (?:my |the )?balance\b|\bwhat'?s my balance\b|\bhow much (?:do i have|is in my)\b`
    + String.raw`|\bfile my (?:tax|taxes|returns)\b|\bpay my (?:kplc|rent|bill|bills)\b`,
    'i',
);

// The past-tense forms, which are records and must win.
const PAST_TENSE_RE =
    /\b(?:sent|paid|bought|transferred|withdrew|deposited|topped ?up|lent|loaded|gave|spent|received|got)\b/i;

export function isCapabilityRequest(text: string): boolean {
    const t = text.trim();
    // A message that reports something already done is data, whatever else it
    // also contains. This is the guard that keeps "sent 500 to Kevin" out.
    if (PAST_TENSE_RE.test(t)) return false;
    return CAPABILITY_RE.test(t);
}

// ── Advice ──────────────────────────────────────────────────────────────────

const ADVICE_RE =
    /\bshould i\b|\bwhat should i do (?:with|about)\b|\bis it (?:a good idea|worth it|better) to\b|\bhow (?:do|can|should) i (?:save|invest|budget|get out of debt|make money)\b|\bwhich (?:loan|sacco|mmf|fund|bank|account) (?:is|should)\b|\bworth (?:investing|saving) in\b|\bdo you recommend\b|\bwhat do you think i should\b/i;

export function isAdviceRequest(text: string): boolean {
    return ADVICE_RE.test(text.trim());
}

// ── Questions about the app ─────────────────────────────────────────────────

const PRIVACY_RE =
    /\b(?:is my data safe|my data safe|data safe|is this (?:safe|private|secure)|do you (?:store|keep|save|send|share|upload)\b.*\b(?:my|messages|data|information)|who can see|can anyone see|where (?:is|does) (?:my|the) data (?:go|stored|kept)|privacy|are you (?:tracking|spying)|do you have my)\b/i;

export function isPrivacyQuestion(text: string): boolean {
    return PRIVACY_RE.test(text.trim());
}

const IDENTITY_RE =
    /\b(?:are you (?:a )?(?:human|person|real|a bot|a robot|ai|an ai|chatgpt|gpt|claude|gemini|a machine|alive))\b|\b(?:what are you|who are you)\b|\b(?:am i talking to a (?:human|person|bot|robot|machine))\b|\bare you an? (?:llm|language model)\b/i;

export function isIdentityQuestion(text: string): boolean {
    return IDENTITY_RE.test(text.trim());
}

const WHO_MADE_RE =
    /\bwho (?:made|built|created|developed|wrote|owns) (?:you|this|m-?track)\b|\bwho'?s behind (?:you|this)\b|\bwho is the (?:developer|creator|owner)\b/i;

export function isWhoMadeYou(text: string): boolean {
    return WHO_MADE_RE.test(text.trim());
}

const COVERAGE_RE =
    /\bdo you (?:support|read|handle|work with|do)\b.*\b(?:airtel|equity|kcb|co-?op|absa|ncba|stanbic|dtb|family bank|sacco|bank|t-?kash|pesalink)\b|\b(?:airtel|equity|kcb|co-?op|absa|ncba|stanbic|dtb|family bank)\b.*\b(?:supported|work|works|read)\b/i;

export function isCoverageQuestion(text: string): boolean {
    return COVERAGE_RE.test(text.trim());
}

const TAX_RE =
    /\b(?:tax invoice|is this (?:a )?(?:tax|legal|official) (?:invoice|receipt|document)|kra|etims|e-?tims|vat|tax purposes|file (?:my )?returns with)\b/i;

export function isTaxQuestion(text: string): boolean {
    return TAX_RE.test(text.trim());
}

const CONNECT_RE =
    /\b(?:connect|link|sync|integrate|hook up|attach)\b.*\b(?:m-?pesa|mpesa|bank|account|airtel|sim)\b|\b(?:read|access|get)\b.*\bmy (?:m-?pesa|mpesa|messages|sms) (?:automatically|directly|by yourself|on your own)\b|\bwhy do i have to (?:paste|copy)\b/i;

export function isConnectionQuestion(text: string): boolean {
    return CONNECT_RE.test(text.trim());
}

// ── Emotion ─────────────────────────────────────────────────────────────────

// Frustration WITH THE APP, including plain abuse. Both get the same calm,
// brief reply and an offer of the simplest path; there is nothing to gain from
// telling them apart, and a bot that decides it is being insulted and says so
// is worse than one that just helps.
const FRUSTRATION_RE =
    /\b(?:useless|annoying|frustrating|rubbish|garbage|terrible|awful|stupid|dumb|pointless|broken|not working|doesn'?t work|hopeless|waste of time|hate this|hate you|so slow|come on|for god'?s sake)\b|\b(?:f[u*]ck|shit|crap|damn|bloody hell|wtf)\b|\byou (?:are|'?re) (?:so )?(?:bad|wrong|dumb|stupid|useless)\b/i;

export function isFrustration(text: string): boolean {
    return FRUSTRATION_RE.test(text.trim());
}

const MONEY_STRESS_RE =
    /\b(?:i'?m broke|im broke|so broke|dead broke|no money|out of money|can'?t afford|cant afford|rough month|tough month|hard month|struggling|skint|pesa imeisha|nimeishiwa|things are tight|money is tight|tight this month|bills are killing|drowning in debt)\b/i;

export function isMoneyStress(text: string): boolean {
    return MONEY_STRESS_RE.test(text.trim());
}

const GOOD_NEWS_RE =
    /\b(?:got paid|just got paid|payday|got a raise|got a bonus|new job|got the job|finally paid|money came through|nimelipwa)\b/i;

export function isGoodNews(text: string): boolean {
    return GOOD_NEWS_RE.test(text.trim());
}

// ── Off topic ───────────────────────────────────────────────────────────────

const SMALL_TALK_RE =
    /^(?:how are you|how'?s it going|how are things|what'?s up|wassup|sup|how'?s your day|you good|you ok|how do you do|niaje|mambo|vipi|habari)\b[\s?!.]*$|\bhow are you (?:doing|today)\b|\bwhat'?s new\b/i;

export function isSmallTalk(text: string): boolean {
    return SMALL_TALK_RE.test(text.trim());
}

const ENTERTAINMENT_RE =
    /\b(?:tell me a joke|say something funny|make me laugh|sing (?:me )?a song|tell me a story|play a game|are you funny|entertain me|riddle)\b/i;

export function isEntertainmentRequest(text: string): boolean {
    return ENTERTAINMENT_RE.test(text.trim());
}

const OTHER_APP_RE =
    /\b(?:book (?:me )?(?:a|an)? ?(?:matatu|uber|bolt|taxi|flight|bus|ticket|table)|order (?:me )?(?:some )?(?:food|pizza|lunch|dinner|glovo|uber eats)|call (?:me )?(?:a|an)? ?(?:uber|bolt|taxi|cab)|set (?:a|an) (?:alarm|reminder)|play (?:some )?music|send (?:a|an) email|text (?:my|him|her))\b/i;

export function isOtherAppTask(text: string): boolean {
    return OTHER_APP_RE.test(text.trim());
}

const PERSONAL_RE =
    /\b(?:do you have a (?:girlfriend|boyfriend|partner|wife|husband|family)|are you single|do you love me|i love you|will you marry me|do you like me|are you pretty|what do you look like|how old are you|where do you live|do you have feelings|are you lonely|do you dream|what'?s your favourite|whats your favorite)\b/i;

export function isPersonalQuestion(text: string): boolean {
    return PERSONAL_RE.test(text.trim());
}

// A language this cannot read. Detected by script, or by a small set of very
// common function words in the European languages most likely to turn up.
// Deliberately weak evidence is not used: one unfamiliar word is a typo far
// more often than it is French.
// Scripts M-Track cannot read. Cyrillic, Arabic, CJK and Kana.
//
// Devanagari and Hangul are deliberately left out. Both ranges contain
// combining marks, which makes a code-unit character class an unreliable test
// on them, and this check is only ever weak evidence anyway: the useful half
// of "is this a language I read?" is the word list below.
const NON_LATIN_RE = new RegExp(
    '[\\u0400-\\u04FF\\u0600-\\u06FF\\u4E00-\\u9FFF\\u3040-\\u30FF]',
);
const EUROPEAN_RE =
    /\b(?:je|voudrais|bonjour|merci|s'il vous plait|s'il vous plaît|quiero|hola|gracias|por favor|necesito|ich|m[oö]chte|danke|bitte|eu|quero|obrigad[oa]|vorrei|grazie|ciao)\b/i;

export function isOtherLanguage(text: string): boolean {
    const t = text.trim();
    if (NON_LATIN_RE.test(t)) return true;
    // Two or more markers, so a single borrowed word is not enough.
    const hits = t.match(new RegExp(EUROPEAN_RE.source, 'gi'));
    return (hits?.length ?? 0) >= 2;
}

// Attempts to talk to the system underneath. Treated as off-topic, calmly:
// there is no system underneath to talk to, and saying "nice try" would be
// both smug and a hint that there is something to find.
const INJECTION_RE =
    /\bignore (?:your|all|the|previous|prior) (?:instructions?|rules?|prompt|programming)\b|\bsystem prompt\b|\bdeveloper mode\b|\bjailbreak\b|\bpretend (?:you are|to be)\b|\bact as (?:a|an)\b|\bforget (?:your|everything|all) (?:instructions?|rules?)\b|\byou are now\b/i;

export function isInjectionAttempt(text: string): boolean {
    return INJECTION_RE.test(text.trim());
}

// General knowledge and everything else outside the lane.
const GENERAL_KNOWLEDGE_RE =
    /\b(?:what'?s the weather|how'?s the weather|weather (?:today|tomorrow)|capital of|who won|what year|who is the president|what time is it|what'?s the date|how far is|translate|what does .{2,20} mean|news today|the news|who is [A-Z]|tell me about)\b/i;

export function isGeneralKnowledge(text: string): boolean {
    return GENERAL_KNOWLEDGE_RE.test(text.trim());
}

// ── The classifier ──────────────────────────────────────────────────────────

// Highest priority first. The order is the design: getting a crisis wrong costs
// most, then wrongly treating a request to move money as a record, then
// anything else.
const LADDER: ReadonlyArray<[EdgeCategory, (t: string) => boolean]> = [
    ['crisis', isCrisis],
    ['capability', isCapabilityRequest],
    ['whoMadeYou', isWhoMadeYou],
    ['identity', isIdentityQuestion],
    ['privacy', isPrivacyQuestion],
    ['noConnection', isConnectionQuestion],
    ['taxInvoice', isTaxQuestion],
    ['coverage', isCoverageQuestion],
    ['advice', isAdviceRequest],
    ['frustration', isFrustration],
    ['moneyStress', isMoneyStress],
    ['goodNews', isGoodNews],
    ['otherApp', isOtherAppTask],
    ['entertainment', isEntertainmentRequest],
    ['personal', isPersonalQuestion],
    ['smallTalk', isSmallTalk],
    ['language', isOtherLanguage],
    ['offTopic', isGeneralKnowledge],
    ['offTopic', isInjectionAttempt],
];

// Which edge category a message falls into, or null when it is in the lane.
export function classifyEdge(text: string): EdgeCategory | null {
    const t = text.trim();
    if (!t) return null;
    for (const [category, test] of LADDER) {
        if (test(t)) return category;
    }
    return null;
}

// The categories that are simply an answer, not a redirect away from something.
// These do not count towards the "you keep going off topic" streak.
const ANSWERED_NOT_REDIRECTED = new Set<EdgeCategory>([
    'privacy', 'identity', 'whoMadeYou', 'coverage', 'taxInvoice', 'noConnection',
    'crisis', 'frustration', 'moneyStress', 'goodNews',
]);

export function countsAsOffTopic(category: EdgeCategory): boolean {
    return !ANSWERED_NOT_REDIRECTED.has(category);
}
