import type { DocumentType, ParsedTransaction } from '../../types';
import { parseAllMessages } from '../parsers';
import type { CaptureSlot } from '../conversationalCapture';
import { chooseMode, emptyConvState, MODE_VALUES, openConversation, receive } from './engine';
import type { BotTurn, ConvState, Effect, PendingPrompt, TurnResult } from './types';
import type { CopyId } from './copy';

// A scripted conversation, driven through the production engine.
//
// The engine is what ChatScreen calls. There is no model of it here and there
// must never be one: the slot-filling suite once carried a hand-written copy of
// the composition and stayed green for weeks through a production bug it could
// not express.

// Fixed so every relative date in the catalogue means one specific day.
export const SCENARIO_NOW = new Date('2026-09-28T09:00:00');

export interface TurnRecord {
    // What the user did. A tap records the option's value.
    user: string;
    tapped: boolean;
    turns: BotTurn[];
    effects: Effect[];
    stateBefore: ConvState | null;
    stateAfter: ConvState | null;
}

export class Conversation {
    state: ConvState | null;
    transactions: ParsedTransaction[] = [];
    readonly history: TurnRecord[] = [];
    // The bot's opening, before any user message.
    readonly opening: BotTurn[];

    constructor(state?: ConvState) {
        if (state) {
            this.state = state;
            this.opening = [];
        } else {
            const opened = openConversation();
            this.state = opened.state;
            this.opening = opened.turns;
        }
    }

    private apply(result: TurnResult, user: string, tapped: boolean): TurnRecord {
        const stateBefore = this.state;
        for (const effect of result.effects) {
            switch (effect.kind) {
                case 'parse-batch':
                    this.transactions = [...this.transactions, ...parseAllMessages(effect.text).transactions];
                    break;
                case 'commit':
                    this.transactions = [...this.transactions, effect.transaction];
                    break;
                case 'update-transactions':
                    this.transactions = effect.transactions;
                    break;
                case 'sync-draft':
                    break;
            }
        }
        this.state = result.state;
        const record: TurnRecord = {
            user, tapped, turns: result.turns, effects: result.effects, stateBefore, stateAfter: result.state,
        };
        this.history.push(record);
        return record;
    }

    send(text: string): TurnRecord {
        return this.apply(
            receive(this.state, text, { now: SCENARIO_NOW, transactions: this.transactions }),
            text, false,
        );
    }

    tap(value: string): TurnRecord {
        if (this.state && this.state.pending === 'mode'
            && (MODE_VALUES as readonly string[]).includes(value)) {
            return this.apply(chooseMode(this.state, value), value, true);
        }
        return this.apply(
            receive(this.state, value, { now: SCENARIO_NOW, transactions: this.transactions }),
            value, true,
        );
    }

    // Everything the bot has said, in order, for the transcript writer.
    allTurns(): BotTurn[] {
        return [...this.opening, ...this.history.flatMap(h => h.turns)];
    }

    last(): TurnRecord | null {
        return this.history.length > 0 ? this.history[this.history.length - 1] : null;
    }
}

// ── Assertion vocabulary ────────────────────────────────────────────────────
//
// Assertions read state and copy ids, never raw strings, so wording can be
// rewritten without touching a scenario. `echoes` is the deliberate exception:
// its whole point is that the user's own words came back.

export type Assertion = (r: TurnRecord, c: Conversation, documentType: DocumentType) => string | null;

const SLOT_PENDING: Record<CaptureSlot, PendingPrompt> = {
    date: 'field-date',
    amount: 'field-amount',
    description: 'field-recipient',
};

function said(r: TurnRecord): CopyId[] {
    return r.turns.flatMap(t => [t.copyId, ...(t.suffixCopyId ? [t.suffixCopyId] : [])]);
}

function textOf(r: TurnRecord): string {
    return r.turns.map(t => t.text).join(' ');
}

// Which question the bot put next.
export function asks(slot: CaptureSlot | PendingPrompt): Assertion {
    const want = (slot in SLOT_PENDING) ? SLOT_PENDING[slot as CaptureSlot] : slot as PendingPrompt;
    return (r) => r.stateAfter?.pending === want
        ? null
        : `expected to be asking ${want}, was ${r.stateAfter?.pending ?? 'nothing (flow ended)'}`;
}

export function doesNotAsk(slot: CaptureSlot): Assertion {
    const want = SLOT_PENDING[slot];
    return (r) => {
        if (r.stateAfter?.pending === want) return `asked ${slot}, which was already known`;
        const ids = said(r);
        const bad = ids.find(id => id === 'ask.date' || id === 'ask.amount' || id.startsWith('ask.party')
            ? pendingOfCopy(id) === want : false);
        return bad ? `said ${bad}, which asks ${slot}` : null;
    };
}

function pendingOfCopy(id: CopyId): PendingPrompt | null {
    if (id === 'ask.date' || id === 'date.retry' || id === 'date.invalid') return 'field-date';
    if (id === 'ask.amount' || id === 'ask.amountRetry') return 'field-amount';
    if (id.startsWith('ask.party')) return 'field-recipient';
    return null;
}

// Which registry entry produced the reply.
//
// Typed as plain strings, not CopyId, on purpose: the catalogue is a floor for
// behaviour that does not all exist yet, and a scenario has to be able to name
// the entry it is waiting for. A PASSING scenario naming an id the registry
// does not hold is caught by the voice lint, which is the check that matters.
//
// More than one id passes if ANY of them was said: several catalogue entries
// have two honest answers depending on what is stored (spend.answer or
// spend.none, say).
export function used(...ids: string[]): Assertion {
    return (r) => {
        const got: string[] = said(r);
        if (ids.length === 0) {
            return got.length === 0 ? null : `expected silence, said ${got.join(', ')}`;
        }
        return ids.some(id => got.includes(id))
            ? null
            : `expected ${ids.join(' or ')}, said ${got.join(', ') || '(nothing)'}`;
    };
}

export function notUsed(...ids: string[]): Assertion {
    return (r) => {
        const got: string[] = said(r);
        const found = ids.filter(id => got.includes(id));
        return found.length === 0 ? null : `said ${found.join(', ')}, which it should not have`;
    };
}

// Which tappable options were shown.
export function offers(values: string[]): Assertion {
    return (r) => {
        const withOptions = r.turns.filter(t => t.options);
        const got = withOptions.length > 0
            ? (withOptions[withOptions.length - 1].options ?? []).map(o => o.value)
            : [];
        return JSON.stringify(got) === JSON.stringify(values)
            ? null
            : `expected options ${JSON.stringify(values)}, got ${JSON.stringify(got)}`;
    };
}

type DraftExpectation = {
    amount?: number | null;
    recipient?: string | null;
    currency?: string;
    dateISO?: string | null;
    dateSkipped?: boolean;
    lineItems?: Array<[string, number]>;
    direction?: 'sent' | 'received';
    documentType?: DocumentType;
    pending?: PendingPrompt;
    committed?: number;
};

// Draft values after the turn.
export function state(expected: DraftExpectation): Assertion {
    return (r, c) => {
        const s = r.stateAfter;
        if (!s) return 'the flow ended, so there is no state to check';
        const d = s.draft;
        const problems: string[] = [];
        const check = (name: string, got: unknown, want: unknown) => {
            if (JSON.stringify(got) !== JSON.stringify(want)) {
                problems.push(`${name}: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`);
            }
        };
        if ('amount' in expected) check('amount', d.amount, expected.amount);
        if ('recipient' in expected) check('recipient', d.recipient, expected.recipient);
        if ('currency' in expected) check('currency', d.currency.code, expected.currency);
        if ('dateISO' in expected) {
            check('date', d.date ? d.date.toISOString().slice(0, 10) : null, expected.dateISO);
        }
        if ('dateSkipped' in expected) check('dateSkipped', d.dateSkipped, expected.dateSkipped);
        if ('lineItems' in expected) {
            check('lineItems', (d.lineItems ?? []).map(i => [i.description, i.amount]), expected.lineItems);
        }
        if ('direction' in expected) check('direction', d.direction.type, expected.direction);
        if ('documentType' in expected) check('documentType', s.documentType, expected.documentType);
        if ('pending' in expected) check('pending', s.pending, expected.pending);
        if ('committed' in expected) check('committed', c.transactions.length, expected.committed);
        return problems.length === 0 ? null : problems.join('; ');
    };
}

// The reply contains user-supplied content.
export function echoes(...fragments: string[]): Assertion {
    return (r) => {
        const text = textOf(r).toLowerCase();
        const missing = fragments.filter(f => !text.includes(f.toLowerCase()));
        return missing.length === 0 ? null : `reply did not echo ${missing.join(', ')}: "${textOf(r)}"`;
    };
}

// A parked question was restored after a detour.
export function resumes(id: CopyId): Assertion {
    return (r) => r.turns.some(t => t.resumedCopyId === id)
        ? null
        : `expected the reply to put ${id} back, it resumed ${r.turns.map(t => t.resumedCopyId ?? '-').join(',')}`;
}

// A detour didn't alter the draft.
export function stateUnchanged(): Assertion {
    return (r) => {
        const before = r.stateBefore;
        const after = r.stateAfter;
        if (!before || !after) return 'the flow started or ended during a turn that should have changed nothing';
        if (before.pending !== after.pending) return `pending moved ${before.pending} -> ${after.pending}`;
        return JSON.stringify(before.draft) === JSON.stringify(after.draft)
            ? null
            : 'the draft changed during a turn that should have changed nothing';
    };
}

// A non-terminal reply ends in a question, options, or a stated action.
export function endsWithNextStep(): Assertion {
    return (r) => {
        if (r.turns.length === 0) return 'the bot said nothing at all';
        const last = r.turns[r.turns.length - 1];
        if (last.kind === 'terminal') return null;
        if (last.options && last.options.length > 0) return null;
        if (/[?]\s*$/.test(last.text)) return null;
        // A stated action: the reply says what happens next in plain words.
        if (/\b(?:tap|say|send|paste|tell me|go ahead|you can)\b/i.test(last.text)) return null;
        return `reply has no next step: "${last.text}"`;
    };
}

// Not the same registry variant as the previous bot turn.
export function notRepeatOfPrevious(): Assertion {
    return (r, c) => {
        const i = c.history.indexOf(r);
        const prior = i > 0 ? c.history[i - 1] : null;
        const priorTurns = prior ? prior.turns : c.opening;
        if (priorTurns.length === 0 || r.turns.length === 0) return null;
        const before = priorTurns[priorTurns.length - 1];
        const now = r.turns[0];
        return before.text === now.text
            ? `said the same thing twice in a row: "${now.text}"`
            : null;
    };
}

// The party/recipient question, whichever wording this document type uses.
export function asksParty(): Assertion {
    return (r, _c, documentType) => {
        const want = `ask.party.${documentType}`;
        return said(r).includes(want as CopyId)
            ? null
            : `expected the ${documentType} party question, said ${said(r).join(', ') || '(nothing)'}`;
    };
}

export function commits(count: number): Assertion {
    return (_r, c) => c.transactions.length === count
        ? null
        : `expected ${count} recorded line(s), got ${c.transactions.length}`;
}

export function flowEnded(): Assertion {
    return (r) => r.stateAfter === null ? null : 'the flow was still running';
}

// ── Running a scenario ──────────────────────────────────────────────────────

export interface Step {
    // What the user does. Exactly one of these.
    send?: string;
    tap?: string;
    expect?: Assertion[];
}

export interface Scenario {
    id: string;
    title: string;
    // Which document types this path applies to. Defaults to all four.
    types?: readonly DocumentType[];
    // Skip the mode preamble and start in the open input state of this type.
    // Used by the scenarios that are not about the opening.
    startInCapture?: boolean;
    steps: Step[];
    // Whether the scenario passes today. A known failure is recorded rather
    // than hidden: the suite asserts that a 'fail' scenario still fails, so the
    // day it starts passing the suite says so.
    status: 'pass' | 'fail' | 'blocked' | 'decision';
    // Required whenever status is not 'pass'.
    note?: string;
}

export const ALL_TYPES: readonly DocumentType[] = [
    'expense_summary', 'personal_note', 'point_of_sale', 'on_behalf_of',
];

// The mode option value that opens a given document type. personal_note is not
// a mode the user picks: it is what "my own spending" becomes once a line is
// described rather than pasted.
export function modeValueFor(documentType: DocumentType): string {
    if (documentType === 'point_of_sale') return 'point_of_sale';
    if (documentType === 'on_behalf_of') return 'on_behalf_of';
    return 'own';
}

// Walks a conversation up to the open input state for a document type, through
// the real mode questions.
export function openInCapture(documentType: DocumentType): Conversation {
    const c = new Conversation();
    c.tap(modeValueFor(documentType));
    if (documentType === 'point_of_sale') c.send('Kibanda');
    if (documentType === 'on_behalf_of') {
        c.send('My boss');
        c.send('skip');
    }
    return c;
}

export interface StepOutcome {
    step: Step;
    record: TurnRecord;
    failures: string[];
}

export interface RunOutcome {
    documentType: DocumentType;
    conversation: Conversation;
    steps: StepOutcome[];
    passed: boolean;
}

export function runScenario(scenario: Scenario, documentType: DocumentType): RunOutcome {
    const c = scenario.startInCapture ? openInCapture(documentType) : new Conversation();
    const steps: StepOutcome[] = [];
    for (const step of scenario.steps) {
        const record = step.tap !== undefined ? c.tap(step.tap) : c.send(step.send ?? '');
        const failures = (step.expect ?? [])
            .map(a => a(record, c, documentType))
            .filter((m): m is string => m !== null);
        steps.push({ step, record, failures });
    }
    return {
        documentType,
        conversation: c,
        steps,
        passed: steps.every(s => s.failures.length === 0),
    };
}

export function typesFor(scenario: Scenario): readonly DocumentType[] {
    return scenario.types ?? ALL_TYPES;
}

export { emptyConvState };
