// Spells out a shilling-and-cents amount in English words, the way a printed
// cheque or a formal receipt does — "ONE THOUSAND TWO HUNDRED AND FIFTY
// SHILLINGS AND FIFTY CENTS ONLY". Pure and currency-generic: takes the
// currency's own plural units/subunits as strings, defaulting to KES's own
// (Shillings / Cents), since that's what every fixture in this app uses.
//
// Deliberately stops at a mundane, complete implementation up to billions —
// anything past that is not a number a single sale on this app will ever
// need to print.

const ONES = [
    '', 'ONE', 'TWO', 'THREE', 'FOUR', 'FIVE', 'SIX', 'SEVEN', 'EIGHT', 'NINE',
    'TEN', 'ELEVEN', 'TWELVE', 'THIRTEEN', 'FOURTEEN', 'FIFTEEN', 'SIXTEEN', 'SEVENTEEN', 'EIGHTEEN', 'NINETEEN',
];
const TENS = ['', '', 'TWENTY', 'THIRTY', 'FORTY', 'FIFTY', 'SIXTY', 'SEVENTY', 'EIGHTY', 'NINETY'];
const SCALES = ['', 'THOUSAND', 'MILLION', 'BILLION'];

function threeDigitsInWords(n: number): string {
    const hundreds = Math.floor(n / 100);
    const rest = n % 100;
    let restWords = '';
    if (rest > 0) {
        if (rest < 20) {
            restWords = ONES[rest];
        } else {
            const tens = Math.floor(rest / 10);
            const ones = rest % 10;
            restWords = ones > 0 ? `${TENS[tens]}-${ONES[ones]}` : TENS[tens];
        }
    }
    if (hundreds > 0 && restWords) return `${ONES[hundreds]} HUNDRED AND ${restWords}`;
    if (hundreds > 0) return `${ONES[hundreds]} HUNDRED`;
    return restWords;
}

function integerInWords(n: number): string {
    if (n === 0) return 'ZERO';
    const groups: string[] = [];
    let remaining = n;
    let scale = 0;
    while (remaining > 0) {
        const group = remaining % 1000;
        if (group > 0) {
            const groupWords = threeDigitsInWords(group);
            groups.unshift(SCALES[scale] ? `${groupWords} ${SCALES[scale]}` : groupWords);
        }
        remaining = Math.floor(remaining / 1000);
        scale++;
    }
    return groups.join(' ');
}

export interface AmountInWordsOptions {
    unit?: string;
    subunit?: string;
}

// `amount` is rounded to the nearest cent first — this is a display string,
// never a value fed back into arithmetic, so rounding here cannot introduce
// the kind of drift the rest of the app is careful to avoid in real totals.
export function amountInWords(amount: number, opts: AmountInWordsOptions = {}): string {
    const unit = opts.unit ?? 'SHILLINGS';
    const subunit = opts.subunit ?? 'CENTS';
    const rounded = Math.round(Math.abs(amount) * 100) / 100;
    const whole = Math.floor(rounded);
    const cents = Math.round((rounded - whole) * 100);

    const wholeWords = `${integerInWords(whole)} ${whole === 1 ? unit.replace(/S$/, '') : unit}`;
    if (cents === 0) return `${wholeWords} ONLY`;

    const centsWords = `${integerInWords(cents)} ${cents === 1 ? subunit.replace(/S$/, '') : subunit}`;
    return `${wholeWords} AND ${centsWords} ONLY`;
}
