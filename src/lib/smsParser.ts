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

    if (!amountMatch || !dateTimeMatch) return null;

    const [dateStr, timeStr] = dateTimeMatch.slice(1);
    const date = parseTransactionDate(dateStr, timeStr);
    const balance = balanceMatch ? parseAmount(balanceMatch[1]) : null;
    const amount = parseAmount(amountMatch[1]);

    // 1. Airtime purchase: 'Ksh50.00 of airtime on ...'
    const airtimeMatch = message.match(/Ksh[\d,]+\.\d{2} of airtime/i);
    if (airtimeMatch) {
        return {
            date,
            time: timeStr,
            type: 'sent',
            amount,
            recipient: 'Airtime',
            transactionCode,
            balance,
            rawLine: message
        };
    }

    // 2. Paybill/Till payment: 'paid to COMPANY NAME 123456 for account ACC123'
    const paybillMatch = message.match(/paid to (.+?) \d+ for account (\S+)/i);
    if (paybillMatch) {
        const companyName = paybillMatch[1].trim();
        const accountRef = paybillMatch[2].trim();
        return {
            date,
            time: timeStr,
            type: 'sent',
            amount,
            recipient: `${companyName} (${accountRef})`,
            transactionCode,
            balance,
            rawLine: message
        };
    }

    // 3. Received: 'received Ksh... from NAME 07XXXXXXXX'
    const receivedFromMatch = message.match(/received Ksh[\d,]+\.\d{2} from (.+?) \d+/i);
    if (receivedFromMatch) {
        return {
            date,
            time: timeStr,
            type: 'received',
            amount,
            recipient: receivedFromMatch[1].trim(),
            transactionCode,
            balance,
            rawLine: message
        };
    }

    // 4. Sent: 'sent to NAME 07XXXXXXXX' or 'to NAME 07XXXXXXXX'
    const sentToMatch = message.match(/sent to (.+?) \d+/i) || message.match(/to (.+?) \d+/i) || message.match(/to (.+?)\./i);
    if (sentToMatch) {
        return {
            date,
            time: timeStr,
            type: 'sent',
            amount,
            recipient: sentToMatch[1].trim(),
            transactionCode,
            balance,
            rawLine: message
        };
    }

    // 5. Fallback: determine type from message content
    const type = message.includes('received') ? 'received' : 'sent';
    return {
        date,
        time: timeStr,
        type,
        amount,
        recipient: 'Unknown',
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
