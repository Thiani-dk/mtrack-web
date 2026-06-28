import type { ParsedTransaction, TransactionSubType } from '../types';

export function parseAmount(str: string): number {
    return parseFloat(str.replace(/Ksh\.?/g, '').replace(/,/g, '').trim());
}

export function parseTransactionDate(dateStr: string, timeStr: string): Date {
    const [day, month, year] = dateStr.split('/').map(Number);
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    return new Date(2000 + year, month - 1, day, hours, minutes);
}

function make(
    base: { date: Date; time: string; amount: number; transactionCode: string; balance: number | null; rawLine: string },
    type: 'sent' | 'received',
    subType: TransactionSubType,
    recipient: string
): ParsedTransaction {
    return { ...base, type, subType, recipient };
}

export function parseSingleSMS(message: string): ParsedTransaction | null {

    // --- Airtel Money (no M-PESA transaction code) ---
    // Format: "Successful. Airtime top up of your line 789561007 of Ksh 50 is successful."
    const airtelMatch = message.match(/Successful\.\s*Airtime top up of your line [\d]+ of Ksh ([\d.]+) is successful/i);
    if (airtelMatch) {
        const amount = parseFloat(airtelMatch[1]);
        return {
            date: new Date(),
            time: '',
            type: 'sent',
            subType: 'airtime',
            amount,
            recipient: 'Airtel Airtime',
            transactionCode: 'AIRTEL',
            balance: null,
            rawLine: message,
        };
    }

    // All M-PESA messages start with a 10-char transaction code
    const transactionCodeMatch = message.match(/^([A-Z0-9]{10})/i);
    if (!transactionCodeMatch) return null;
    const transactionCode = transactionCodeMatch[1].toUpperCase();

    const amountMatch  = message.match(/Ksh\.?([\d,]+\.\d{2})/);
    const dateTimeMatch = message.match(/(\d{1,2}\/\d{1,2}\/\d{2}) at (\d{1,2}:\d{2} [AP]M)/);
    const balanceMatch  = message.match(/New M-PESA balance is Ksh\.?([\d,]+\.\d{2})/);

    if (!amountMatch || !dateTimeMatch) return null;

    const [dateStr, timeStr] = dateTimeMatch.slice(1);
    const date    = parseTransactionDate(dateStr, timeStr);
    const balance = balanceMatch ? parseAmount(balanceMatch[1]) : null;
    const amount  = parseAmount(amountMatch[1]);
    const base    = { date, time: timeStr, amount, transactionCode, balance, rawLine: message };

    // 1. Airtime purchase (M-PESA)
    if (/of airtime/i.test(message)) {
        return make(base, 'sent', 'airtime', 'Airtime');
    }

    // 2. Data bundle purchase
    // "sent to SAFARICOM DATA BUNDLES for account SAFARICOM DATA BUNDLES"
    if (/SAFARICOM DATA BUNDLES/i.test(message)) {
        return make(base, 'sent', 'data', 'Safaricom Data Bundles');
    }

    // 3. Agent cash withdrawal
    const withdrawMatch = message.match(/Withdraw Ksh[\d,]+\.\d{2} from ([\d]+ - .+?)(?:\s+New M-PESA|\s+on \d)/i);
    if (withdrawMatch) {
        return make(base, 'sent', 'withdrawal', `Withdrawal: ${withdrawMatch[1].trim()}`);
    }

    // 4. M-Shwari deposit (sent TO M-Shwari)
    if (/transferred to M-Shwari/i.test(message)) {
        return make(base, 'sent', 'mshwari', 'M-Shwari');
    }

    // 5. M-Shwari withdrawal (received FROM M-Shwari)
    if (/transferred from M-Shwari/i.test(message)) {
        return make(base, 'received', 'mshwari', 'M-Shwari');
    }

    // 6. ZIIDI MMF deposit (sent TO ZIIDI)
    // "sent to ZIIDI on DATE" — no phone number, no account number
    if (/sent to ZIIDI\b/i.test(message)) {
        return make(base, 'sent', 'investment', 'ZIIDI MMF');
    }

    // 7. ZIIDI MMF withdrawal (received FROM ZIIDI)
    if (/received Ksh[\d,]+\.\d{2} from ZIIDI\b/i.test(message)) {
        return make(base, 'received', 'investment', 'ZIIDI MMF');
    }

    // 8. Paybill / Till WITH account number
    // "sent to COMPANY for account ACCNUM" or "paid to COMPANY for account ACCNUM"
    const paybillWithAccountMatch = message.match(/(?:sent |paid )?to ([A-Za-z].+?) for account (\S+)/i);
    if (paybillWithAccountMatch) {
        const company = paybillWithAccountMatch[1].trim();
        const account = paybillWithAccountMatch[2].replace(/\.$/, '');
        // Don't double-match SAFARICOM DATA BUNDLES (caught above)
        return make(base, 'sent', 'paybill', `${company} (${account})`);
    }

    // 9. Till payment WITHOUT account number
    // "paid to MERCHANT NAME. on ..." — merchant name ends with a period before "on"
    const tillMatch = message.match(/paid to ([A-Za-z][^.]+?)\.\s+(?:on\s+\d|New)/i);
    if (tillMatch) {
        return make(base, 'sent', 'paybill', tillMatch[1].trim());
    }

    // 10. TerraPay international receive
    // "received Ksh... from NAME in UG via TerraPay"
    const terraPayMatch = message.match(/received Ksh[\d,]+\.\d{2} from (.+?) in \w+ via TerraPay/i);
    if (terraPayMatch) {
        return make(base, 'received', 'person_receive', `${terraPayMatch[1].trim()} (International)`);
    }

    // 11. Received from a person (local)
    // Phone number is 9–13 digits, optionally prefixed with +
    const receivedMatch = message.match(/received Ksh[\d,]+\.\d{2} from (.+?) (?:\+?\d{9,13})/i);
    if (receivedMatch) {
        return make(base, 'received', 'person_receive', receivedMatch[1].trim());
    }

    // 12. Sent to a person WITH phone number (regular send)
    const sentWithPhoneMatch = message.match(/sent to ([A-Za-z'].+?) (?:\+?\d{9,13})/i);
    if (sentWithPhoneMatch) {
        return make(base, 'sent', 'person_send', sentWithPhoneMatch[1].trim());
    }

    // 13. Pochi la Biashara send — "sent to NAME on DATE" with NO phone number
    // The name is followed directly by "on D/M/YY"
    const pochiMatch = message.match(/sent to ([A-Za-z][A-Za-z\s']+?)\s+on\s+\d{1,2}\/\d{1,2}\/\d{2}/i);
    if (pochiMatch) {
        return make(base, 'sent', 'pochi_send', pochiMatch[1].trim());
    }

    // 14. Fallback
    const type: 'sent' | 'received' = /received/i.test(message) ? 'received' : 'sent';
    return make(base, type, 'unknown', 'Unknown');
}

export function parseAllSMS(rawText: string): ParsedTransaction[] {
    let bodies: string[] = [];
    const trimmed = rawText.trim();

    if (trimmed.startsWith('<') && trimmed.includes('body=')) {
        const bodyRegex = /body="((?:[^"\\]|\\.)*)"/g;
        let match;
        while ((match = bodyRegex.exec(trimmed)) !== null) {
            const decoded = match[1]
                .replace(/&amp;/g, '&')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&quot;/g, '"')
                .replace(/&#10;/g, '\n')
                .replace(/&apos;/g, "'");
            bodies.push(decoded);
        }
    } else {
        bodies = trimmed
            .split(/\n{2,}|\n(?=[A-Z0-9]{10}\s)/i)
            .map(s => s.trim())
            .filter(Boolean);
    }

    const transactions = bodies
        .map(parseSingleSMS)
        .filter(Boolean) as ParsedTransaction[];

    return transactions.sort((a, b) => a.date.getTime() - b.date.getTime());
}