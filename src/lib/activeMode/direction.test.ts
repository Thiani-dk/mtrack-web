import { describe, expect, it } from 'vitest';
import { parseAllSMS } from '../parsers';
import { applyActiveModeDirection, applyActiveModeDirectionAll } from './direction';

// The Active Mode direction exception, and — just as importantly — proof that
// it is scoped. The general rule (balance oracle → keyword → structural → ask
// the user) is load-bearing everywhere else in the app, so these tests assert
// both that the exception fires inside Active Mode and that nothing outside it
// changed.

// A confirmation the classifier accepts ("approved" is a transaction verb) but
// whose direction nothing can settle: no verb the keyword layer knows, no
// "to/from your account" for the structural layer, and nothing to reconcile a
// balance against on its own.
const UNRESOLVABLE =
    'TGH7YU2XQ1 Confirmed. Ksh1,200.00 approved on 11/9/26 at 1:15 PM. '
    + 'New M-PESA balance is Ksh9,000.00.';

// Plainly money in — the keyword layer settles this one on its own.
const CLEARLY_RECEIVED =
    'RJH2P9XQ7K Confirmed. You have received Ksh2,500.00 from JANE MUTHONI 0798123456 '
    + 'on 11/9/26 at 9:05 AM. New M-PESA balance is Ksh17,730.00.';

// Plainly money out.
const CLEARLY_SENT =
    'QGH7XK9P2L Confirmed. Ksh1,000.00 sent to KEVIN ELIJAH 0712345678 on 11/9/26 at 7:38 PM. '
    + 'New M-PESA balance is Ksh15,230.00. Transaction cost, Ksh0.00.';

describe('outside Active Mode — unchanged', () => {
    it('still leaves an unresolvable direction unresolved, for the user to answer', () => {
        const [t] = parseAllSMS(UNRESOLVABLE);
        expect(t).toBeDefined();
        expect(t.directionUnresolved).toBe(true);
        expect(t.directionSource).toBe('unresolved');
        // Which is what routes it to the "money in or out?" question, and what
        // forces the low confidence level that flags it for review.
        expect(t.confidenceLevel).toBe('low');
        expect(t.missingFields).toContain('direction');
        // The exception has not leaked into the general pipeline.
        expect(t.directionAssumed).toBe(false);
    });

    it('still resolves what it can resolve', () => {
        expect(parseAllSMS(CLEARLY_RECEIVED)[0].type).toBe('received');
        expect(parseAllSMS(CLEARLY_SENT)[0].type).toBe('sent');
        expect(parseAllSMS(CLEARLY_SENT)[0].directionAssumed).toBe(false);
    });

    it('defaults the new fields on every transaction it builds', () => {
        const [t] = parseAllSMS(CLEARLY_SENT);
        expect(t.bucketLabel).toBeNull();
        expect(t.directionAssumed).toBe(false);
    });
});

describe('inside Active Mode — the scoped exception', () => {
    it('fills an unresolvable direction in as received, without asking', () => {
        const [raw] = parseAllSMS(UNRESOLVABLE);
        const t = applyActiveModeDirection(raw);

        expect(t.type).toBe('received');
        expect(t.directionAssumed).toBe(true);
        // Nothing left open, so nothing routes to the question flow.
        expect(t.directionUnresolved).toBe(false);
        expect(t.missingFields).not.toContain('direction');
    });

    it('keeps an honest record of why it says received', () => {
        // directionSource is what the message actually told us, which was
        // nothing. directionAssumed is what says we filled it in regardless.
        const t = applyActiveModeDirection(parseAllSMS(UNRESOLVABLE)[0]);
        expect(t.directionSource).toBe('unresolved');
        expect(t.directionAssumed).toBe(true);
    });

    it('re-derives the subType and sender to match money coming in', () => {
        const t = applyActiveModeDirection(parseAllSMS(UNRESOLVABLE)[0]);
        expect(t.sender).not.toBeNull();
        expect(t.subType).not.toBe('unknown');
    });

    it('lifts the confidence floor that existed only because a question was open', () => {
        const raw = parseAllSMS(UNRESOLVABLE)[0];
        expect(raw.confidenceLevel).toBe('low');
        expect(applyActiveModeDirection(raw).confidenceLevel).not.toBe('low');
    });

    it('does not touch a direction the message actually resolved', () => {
        // The exception is a last resort, after the same three layers have run
        // and failed. A real answer always wins.
        const received = applyActiveModeDirection(parseAllSMS(CLEARLY_RECEIVED)[0]);
        expect(received.type).toBe('received');
        expect(received.directionAssumed).toBe(false);

        // Including when the real answer disagrees with "everything here is a
        // sale" — a mis-pasted outgoing payment is still recorded as outgoing.
        const sent = applyActiveModeDirection(parseAllSMS(CLEARLY_SENT)[0]);
        expect(sent.type).toBe('sent');
        expect(sent.directionAssumed).toBe(false);
        expect(sent.directionSource).toBe('keyword');
    });

    it('leaves a balance-proven direction alone', () => {
        // Two chained messages let the balance oracle prove direction
        // arithmetically; that proof outranks everything, exception included.
        const pair = parseAllSMS(`${CLEARLY_SENT}\n\n${CLEARLY_RECEIVED}`);
        for (const t of applyActiveModeDirectionAll(pair)) {
            if (t.directionSource === 'balance') expect(t.directionAssumed).toBe(false);
        }
    });

    it('maps a whole batch', () => {
        const batch = parseAllSMS(`${UNRESOLVABLE}\n\n${CLEARLY_SENT}`);
        const out = applyActiveModeDirectionAll(batch);
        expect(out).toHaveLength(batch.length);
        expect(out.filter(t => t.directionAssumed)).toHaveLength(1);
    });
});
