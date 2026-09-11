import type { ParsedTransaction } from '../../types';
import { deriveSubType } from '../parsers';
import { scoreWithContext } from '../parsers/confidence';

// The Active Mode direction default — a narrow, deliberately scoped exception.
//
// The rule everywhere else in this app is that direction is never silently
// defaulted: the balance oracle, then keywords, then structural inference, and
// if all three fail the user is asked "money in or out?". That rule is right,
// and none of it changes here.
//
// Active Mode is the one place where asking is the wrong move. A vendor with a
// queue in front of them opened a screen whose entire purpose is recording
// sales; every capture in it is money coming in. Stopping them mid-rush to ask
// a question they answered by opening the screen would make the feature
// useless at exactly the moment it is meant to be used.
//
// So, inside an Active Mode session only, and ONLY after the same three
// resolution layers have already run and failed, the direction is filled in as
// 'received' rather than asked about — and the fill-in is recorded on the
// transaction (directionAssumed) so it can be shown as a quiet marker later.
// Recorded, not hidden. The difference from the general case is which action
// an unresolved direction triggers, not whether it is tracked.
//
// Outside Active Mode this function is never called and the exception does not
// exist.

export function applyActiveModeDirection(t: ParsedTransaction): ParsedTransaction {
    // The message settled it — by arithmetic, by wording, or by structure.
    // The exception is a last resort and must never displace a real answer.
    if (!t.directionUnresolved) return t;

    const type = 'received' as const;
    const assumed: ParsedTransaction = {
        ...t,
        type,
        // Direction is no longer open, so nothing routes this to the question
        // flow. directionSource stays 'unresolved' because that remains the
        // honest account of what the message told us — directionAssumed is
        // what says we filled it in anyway.
        directionUnresolved: false,
        directionAssumed: true,
        subType: deriveSubType(t.method, type, t.isBusiness, t.merchant ?? t.recipient),
        // Money in: the counterparty is the sender.
        sender: t.sender ?? t.recipient,
    };

    // Re-score without the unresolved-direction override, which forced 'low'
    // purely because a question was outstanding. Everything else about the
    // scoring is unchanged.
    const rescored = scoreWithContext(assumed, t.rawLine);
    return {
        ...assumed,
        confidence: rescored.score,
        confidenceLevel: rescored.level,
        // scoreWithContext derives `missing` from directionSource, which we
        // left as 'unresolved' on purpose. Direction is no longer *missing*
        // though — it is assumed, which is a different state and is recorded
        // in directionAssumed. missingFields drives what still gets asked
        // about, and this no longer does.
        missingFields: rescored.missing.filter(f => f !== 'direction'),
    };
}

export function applyActiveModeDirectionAll(transactions: ParsedTransaction[]): ParsedTransaction[] {
    return transactions.map(applyActiveModeDirection);
}
