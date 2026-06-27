import { ParsedTransaction, TransactionSubType } from '../types';

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
    const transactionCodeMatch = message.match(/^([A-Z0-9]{10})/i);
    if (!transactionCodeMatch) return null;
    const transactionCode = transactionCodeMatch[1].toUpperCase();

    const amountMatch = message.match(/Ksh\.?([\d,]+\.\d{2})/);
    const dateTimeMatch = message.match(/(\d{1,2}\/\d{1,2}\/\d{2}) at (\d{1,2}:\d{2} [AP]M)/);
    const balanceMatch = message.match(/New M-PESA balance is Ksh\.?([\d,]+\.\d{2})/);

    if (!amountMatch || !dateTimeMatch) return null;

    const [dateStr, timeStr] = dateTimeMatch.slice(1);
    const date = parseTransactionDate(dateStr, timeStr);
    const balance = balanceMatch ? parseAmount(balanceMatch[1]) : null;
    const amount = parseAmount(amountMatch[1]);

    const base = { date, time: timeStr, amount, transactionCode, balance, rawLine: message };

    // 1. Airtime purchase
    if (/of airtime/i.test(message)) {
        return make(base, 'sent', 'airtime', 'Airtime');
    }

    // 2. Agent cash withdrawal
    // Format: "Withdraw Ksh... from 482681 - AGENT NAME ..."
    const withdrawMatch = message.match(/Withdraw Ksh[\d,]+\.\d{2} from ([\d]+ - .+?)(?:\s+New M-PESA|\s+on \d)/i);
    if (withdrawMatch) {
        return make(base, 'sent', 'withdrawal', `Withdrawal: ${withdrawMatch[1].trim()}`);
    }

    // 3. M-Shwari savings transfer
    if (/transferred to M-Shwari/i.test(message)) {
        return make(base, 'sent', 'mshwari', 'M-Shwari');
    }

    // 4. Paybill / Till WITH account number
    // Format: "sent to COMPANY for account ACCNUM" or "paid to COMPANY for account ACCNUM"
    const paybillWithAccountMatch = message.match(/(?:sent |paid )?to ([A-Za-z].+?) for account (\S+)/i);
    if (paybillWithAccountMatch) {
        const company = paybillWithAccountMatch[1].trim();
        const account = paybillWithAccountMatch[2].replace(/\.$/, '');
        return make(base, 'sent', 'paybill', `${company} (${account})`);
    }

    // 5. Till payment WITHOUT account number
    // Format: "paid to MERCHANT NAME. on ..."  — merchant name ends with a period
    const tillMatch = message.match(/paid to ([A-Z][^.]+?)\.\s+on/i);
    if (tillMatch) {
        return make(base, 'sent', 'paybill', tillMatch[1].trim());
    }

    // 6. Received from a person
    // Phone number is 9–13 digits, optionally prefixed with +
    const receivedMatch = message.match(/received Ksh[\d,]+\.\d{2} from (.+?) (?:\+?\d{9,13})/i);
    if (receivedMatch) {
        return make(base, 'received', 'person_receive', receivedMatch[1].trim());
    }

    // 7. Sent to a person
    const sentMatch = message.match(/sent to ([A-Za-z'].+?) (?:\+?\d{9,13})/i);
    if (sentMatch) {
        return make(base, 'sent', 'person_send', sentMatch[1].trim());
    }

    // 8. Fallback
    const type: 'sent' | 'received' = /received/i.test(message) ? 'received' : 'sent';
    return make(base, type, 'unknown', 'Unknown');
}

export function parseAllSMS(rawText: string): ParsedTransaction[] {
    let bodies: string[] = [];

    const trimmed = rawText.trim();

    // Detect Android XML backup format (SMS Backup & Restore exports)
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
        // Plain text: split on blank lines or a new transaction code at line start
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