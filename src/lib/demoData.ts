// Realistic, entirely fictional M-PESA + card message set for demo mode.
// Dates are generated relative to "now" at call time so the demo always
// looks current — never hardcode absolute dates here.

function dateAt(daysAgo: number, hour: number, minute: number): Date {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d;
}

function fmtAmt(n: number): string {
    return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

// M-PESA style: "5/8/26 at 3:00 PM"
function fmtMpesaDate(d: Date): string {
    const day = d.getDate();
    const month = d.getMonth() + 1;
    const year = d.getFullYear() % 100;
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${day}/${month}/${year} at ${hours}:${mm} ${ampm}`;
}

// Co-op card alert style: "05-08-2026 3:00 PM"
function fmtCoopDate(d: Date): string {
    const day = d.getDate().toString().padStart(2, '0');
    const month = (d.getMonth() + 1).toString().padStart(2, '0');
    let hours = d.getHours();
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `${day}-${month}-${d.getFullYear()} ${hours}:${mm} ${ampm}`;
}

function fakeCode(): string {
    const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    const digits = '23456789';
    let s = '';
    for (let i = 0; i < 10; i++) {
        s += i % 2 === 0
            ? letters[Math.floor(Math.random() * letters.length)]
            : digits[Math.floor(Math.random() * digits.length)];
    }
    return s;
}

function send(amount: number, name: string, phone: string, daysAgo: number, hour: number, minute: number, balance: number, cost = 0): string {
    const date = fmtMpesaDate(dateAt(daysAgo, hour, minute));
    return `${fakeCode()} Confirmed. Ksh${fmtAmt(amount)} sent to ${name} ${phone} on ${date}. New M-PESA balance is Ksh${fmtAmt(balance)}. Transaction cost, Ksh${fmtAmt(cost)}.`;
}

function receive(amount: number, name: string, phone: string, daysAgo: number, hour: number, minute: number, balance: number): string {
    const date = fmtMpesaDate(dateAt(daysAgo, hour, minute));
    return `${fakeCode()} Confirmed. You have received Ksh${fmtAmt(amount)} from ${name} ${phone} on ${date}. New M-PESA balance is Ksh${fmtAmt(balance)}.`;
}

function paybill(amount: number, biz: string, account: string, daysAgo: number, hour: number, minute: number, balance: number, cost = 0): string {
    const date = fmtMpesaDate(dateAt(daysAgo, hour, minute));
    return `${fakeCode()} Confirmed. Ksh${fmtAmt(amount)} sent to ${biz} for account ${account} on ${date}. New M-PESA balance is Ksh${fmtAmt(balance)}. Transaction cost, Ksh${fmtAmt(cost)}.`;
}

function till(amount: number, biz: string, daysAgo: number, hour: number, minute: number, balance: number, cost = 0): string {
    const date = fmtMpesaDate(dateAt(daysAgo, hour, minute));
    return `${fakeCode()} Confirmed. Ksh${fmtAmt(amount)} paid to ${biz}. on ${date}. New M-PESA balance is Ksh${fmtAmt(balance)}. Transaction cost, Ksh${fmtAmt(cost)}.`;
}

function airtime(amount: number, daysAgo: number, hour: number, minute: number, balance: number): string {
    const date = fmtMpesaDate(dateAt(daysAgo, hour, minute));
    return `${fakeCode()} Confirmed. You bought Ksh${fmtAmt(amount)} of airtime on ${date}. New M-PESA balance is Ksh${fmtAmt(balance)}.`;
}

function dataBundle(amount: number, daysAgo: number, hour: number, minute: number, balance: number): string {
    const date = fmtMpesaDate(dateAt(daysAgo, hour, minute));
    return `${fakeCode()} Confirmed. You have purchased Ksh${fmtAmt(amount)} SAFARICOM DATA BUNDLES on ${date}. New M-PESA balance is Ksh${fmtAmt(balance)}.`;
}

function card(amount: number, merchant: string, location: string, daysAgo: number, hour: number, minute: number, balance: number): string {
    const date = fmtCoopDate(dateAt(daysAgo, hour, minute));
    return `Card PAYMENT of KES ${fmtAmt(amount)} on ${merchant}>${location} ${date} Avail Bal KES ${fmtAmt(balance)}. Co-operative Bank.`;
}

// A deliberately garbled message — enough for the parser to build a
// transaction (it has an amount, a date, and a transaction verb so the
// pre-extraction classifier still lets it through) but nothing else — no
// recognisable recipient, code, or provider — so it lands in the genuinely
// low-confidence bucket rather than getting rejected outright.
function messyMessage(daysAgo: number, hour: number, minute: number): string {
    const date = fmtMpesaDate(dateAt(daysAgo, hour, minute));
    return `Paid Ksh1,500 for something on ${date}, not sure what for tbh`;
}

// A GlobalPay virtual-card purchase: the M-PESA send SMS and the card's
// own approval SMS, sharing a transaction code — demonstrates the Part A
// linking/merchant-cleanup behaviour (a padded "PWL*Merchant   City   CC"
// descriptor collapsing into a clean merchant name) rather than just the
// plain M-PESA-send format used everywhere else in this demo set.
function globalPaySend(code: string, amount: number, merchantBlob: string, daysAgo: number, hour: number, minute: number, balance: number): string {
    const date = fmtMpesaDate(dateAt(daysAgo, hour, minute));
    return `${code} Confirmed. Ksh${fmtAmt(amount)} sent to M-PESA CARD for account ${merchantBlob} on ${date}. New M-PESA balance is Ksh${fmtAmt(balance)}. Transaction cost, Ksh0.00.`;
}

function globalPayApproval(code: string, amount: number, merchantBlob: string, cardLast4: string): string {
    return `Dear Customer, a transaction ${code} of Ksh. ${fmtAmt(amount)} (inclusive of Ksh. 0.00 charge) done at ${merchantBlob} has been approved on your card ****${cardLast4}. If not yours, contact us for assistance via; X (@Safaricom_Care, @SafaricomPLC), Facebook (@SafaricomPLC), or by calling 100 or 200.`;
}

export function generateDemoMessages(): string {
    let balance = 42000;
    const messages: string[] = [];

    messages.push(send(500, 'DAVID KAMAU', '0712345678', 13, 9, 15, balance -= 500));
    messages.push(till(150, 'MAMA MBOGA STORES', 13, 17, 40, balance -= 150));
    messages.push(airtime(100, 12, 8, 5, balance -= 100));
    messages.push(card(1100, 'Netflix.com', 'Los Gatos NL', 12, 10, 22, balance -= 1100));
    messages.push(receive(3500, 'JANE WANJIKU', '0798112233', 11, 14, 5, balance += 3500));
    messages.push(paybill(15000, 'KODI HOUSING AGENCY', 'HSE4521', 10, 9, 0, balance -= 15000, 105));
    messages.push(till(150, 'MAMA MBOGA STORES', 10, 18, 12, balance -= 150));
    messages.push(card(480, 'Spotify P9X2K1', 'Stockholm SE', 9, 11, 45, balance -= 480));
    messages.push(till(3200, 'KIBET AUTO SPARES', 9, 16, 30, balance -= 3200, 33));
    messages.push(dataBundle(1000, 8, 7, 50, balance -= 1000));
    messages.push(airtime(100, 8, 19, 5, balance -= 100));
    messages.push(send(1000, 'MERCY NJERI', '0722556677', 7, 12, 40, balance -= 1000, 11));
    messages.push(till(180, 'MAMA MBOGA STORES', 7, 17, 5, balance -= 180));
    const globalPayCode = fakeCode();
    const globalPayBlob = 'PWL*Uber Eats                Nairobi      KE';
    balance -= 450;
    messages.push(globalPaySend(globalPayCode, 450, globalPayBlob, 6, 12, 30, balance));
    messages.push(globalPayApproval(globalPayCode, 450, globalPayBlob, '7421'));
    messages.push(messyMessage(6, 15, 0));
    messages.push(card(350, 'Google One', 'Mountain View US', 6, 6, 40, balance -= 350));
    messages.push(paybill(1800, 'CITY POWER & LIGHT', '0091234567', 5, 20, 10, balance -= 1800, 22));
    messages.push(receive(12000, 'PETER OTIENO', '0733889900', 5, 8, 0, balance += 12000));
    messages.push(till(2400, 'GREENFIELD ELECTRONICS', 4, 15, 20, balance -= 2400, 33));
    messages.push(airtime(100, 4, 9, 30, balance -= 100));
    messages.push(paybill(4500, 'BRIGHT STAR ACADEMY', 'STU3390', 3, 8, 45, balance -= 4500, 55));
    messages.push(till(170, 'MAMA MBOGA STORES', 3, 17, 55, balance -= 170));
    messages.push(card(1200, 'Canva Pro', 'Sydney AU', 2, 13, 10, balance -= 1200));
    messages.push(receive(800, 'GRACE ACHIENG', '0700123456', 2, 16, 40, balance += 800));
    messages.push(till(650, 'SUNRISE PHARMACY', 1, 12, 15, balance -= 650));
    messages.push(airtime(100, 1, 18, 0, balance -= 100));
    messages.push(send(2000, 'DAVID KAMAU', '0712345678', 0, 10, 30, balance - 2000, 22));

    return messages.join('\n\n');
}
