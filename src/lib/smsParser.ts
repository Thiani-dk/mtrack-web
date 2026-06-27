import { ParsedTransaction } from '../types';

export function parseAmount(str: string): number {
    return parseFloat(str.replace('Ksh', '').replace(/,/g, '').trim());
}

export function parseTransactionDate(dateStr: string, timeStr: string): Date {
    const [day, month, year] = dateStr.split('/').map(Number);
    const [time, period] = timeStr.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    
    if (period === 'PM' && hours < 12) hours += 12;
    if (period === 'AM' && hours === 12) hours = 0;
    
    return new Date(2000 + year, month - 1, day, hours, minutes);
}

export function parseSingleSMS(message: string): ParsedTransaction | null {
    const transactionCodeMatch = message.match(/^([A-Z0-9]{10})/);
    if (!transactionCodeMatch) return null;

    const transactionCode = transactionCodeMatch[1];
    const amountMatch = message.match(/Ksh([\d,]+\.\d{2})/);
    const dateTimeMatch = message.match(/(\d{1,2}\/\d{1,2}\/\d{2}) at (\d{1,2}:\d{2} [AP]M)/);
    const balanceMatch = message.match(/New M-PESA balance is Ksh([\d,]+\.\d{2})/);
    const recipientMatch = message.match(/from (.+?) \d+/i) || message.match(/to (.+?) \d+/i) || message.match(/to (.+?)\./i);

    if (!amountMatch || !dateTimeMatch) return null;

    const type = message.includes('received') ? 'received' : 'sent';
    const amount = parseAmount(amountMatch[1]);
    const [dateStr, timeStr] = dateTimeMatch.slice(1);
    const date = parseTransactionDate(dateStr, timeStr);
    const balance = balanceMatch ? parseAmount(balanceMatch[1]) : null;
    const recipient = recipientMatch ? recipientMatch[1].trim() : 'Unknown';

    return {
        date,
        time: timeStr,
        type,
        amount,
        recipient,
        transactionCode,
        balance,
        rawLine: message
    };
}

export function parseAllSMS(rawText: string): ParsedTransaction[] {
    const chunks = rawText.split(/\n\n|\n(?=[A-Z0-9]{10})/);
    const transactions = chunks.map(parseSingleSMS).filter(Boolean) as ParsedTransaction[];
    return transactions.sort((a, b) => a.date.getTime() - b.date.getTime());
}
