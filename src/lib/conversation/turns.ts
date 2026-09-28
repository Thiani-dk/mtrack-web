import type { ChatOption } from '../../types';
import { copyEntry, render, type CopyId, type CopyParams } from './copy';
import type { BotTurn, ConvState, Effect } from './types';

export interface SayExtra {
    options?: ChatOption[];
    suffixCopyId?: CopyId;
    resumedCopyId?: CopyId;
}

// Builds one turn's worth of bot replies.
//
// Every sentence the bot says goes through `say`, which is what makes the
// harness able to assert on ids rather than strings, and what makes the voice
// lint able to prove no literal escaped the registry.
//
// Variants rotate rather than being picked at random. Random variation reads
// the same to a user and makes a transcript irreproducible, which would defeat
// the whole point of CONVERSATION_TRANSCRIPTS.md.
export class TurnBuilder {
    readonly turns: BotTurn[] = [];
    readonly effects: Effect[] = [];
    // A copy of the incoming cursor, advanced as lines are said.
    readonly cursor: Record<string, number>;

    constructor(cursor: Record<string, number>) {
        this.cursor = { ...cursor };
    }

    say(id: CopyId, params: CopyParams = {}, extra: SayExtra = {}): BotTurn {
        const text = this.text(id, params);
        const suffix = extra.suffixCopyId ? this.text(extra.suffixCopyId) : '';
        const turn: BotTurn = {
            copyId: id,
            kind: copyEntry(id).kind,
            text: suffix ? `${text} ${suffix}` : text,
            ...(extra.options ? { options: extra.options } : {}),
            ...(extra.suffixCopyId ? { suffixCopyId: extra.suffixCopyId } : {}),
            ...(extra.resumedCopyId ? { resumedCopyId: extra.resumedCopyId } : {}),
        };
        this.turns.push(turn);
        return turn;
    }

    // Renders one entry and advances its variant cursor, without emitting a
    // turn. For the halves of a composed sentence.
    text(id: CopyId, params: CopyParams = {}): string {
        const entry = copyEntry(id);
        const n = entry.variants.length;
        const prev = this.cursor[id];
        const index = prev === undefined ? 0 : (prev + 1) % n;
        this.cursor[id] = index;
        return render(entry.variants[index], params);
    }

    // The label for a tappable option, read from the registry like any other
    // bot-facing string. Options never carry a literal.
    static option(id: CopyId, value: string, subId?: CopyId): ChatOption {
        const label = copyEntry(id).variants[0];
        const sublabel = subId ? copyEntry(subId).variants[0] : undefined;
        return { id: id.replace(/\./g, '-'), label, value, ...(sublabel ? { sublabel } : {}) };
    }

    effect(e: Effect): void {
        this.effects.push(e);
    }

    // Folds the cursor and the last-said id back into the state that carries on.
    settle(state: ConvState | null): ConvState | null {
        if (!state) return null;
        const last = this.turns.length > 0 ? this.turns[this.turns.length - 1].copyId : state.lastCopyId;
        return { ...state, variantCursor: this.cursor, lastCopyId: last };
    }
}
