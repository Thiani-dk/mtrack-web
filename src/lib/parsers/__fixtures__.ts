// Real-shape sample messages exercising every extractor path. Used by the
// verification script and available for future unit tests.

export interface Fixture {
    id: string;
    description: string;
    raw: string;
}

export const FIXTURES: Fixture[] = [
    {
        id: 'mpesa-send',
        description: 'M-PESA P2P send, slash date with day > 12 (unambiguous DD/MM)',
        raw: 'QGH7XK9P2L Confirmed. Ksh1,000.00 sent to KEVIN ELIJAH 0712345678 on 21/8/26 at 7:38 PM. New M-PESA balance is Ksh15,230.00. Transaction cost, Ksh0.00. Amount you can transact within the day is Ksh499,000.00. Never share your M-PESA PIN with anyone.',
    },
    {
        id: 'mpesa-receive',
        description: 'M-PESA P2P receive',
        raw: 'RJH2P9XQ7K Confirmed. You have received Ksh2,500.00 from JANE MUTHONI 0798123456 on 20/8/26 at 9:05 AM. New M-PESA balance is Ksh17,730.00.',
    },
    {
        id: 'mpesa-paybill',
        description: 'M-PESA paybill with account number',
        raw: 'THG5K2P8XN Confirmed. Ksh3,200.00 sent to KPLC PREPAID for account 0055667788 on 19/8/26 at 2:47 PM. New M-PESA balance is Ksh14,530.00. Transaction cost, Ksh22.00.',
    },
    {
        id: 'mpesa-till',
        description: 'M-PESA till payment, no account number',
        raw: 'NBV3P7X9KQ Confirmed. Ksh450.00 paid to NAIVAS SUPERMARKET LTD. on 18/8/26 at 6:12 PM. New M-PESA balance is Ksh14,080.00. Transaction cost, Ksh0.00.',
    },
    {
        id: 'mpesa-airtime',
        description: 'M-PESA airtime purchase',
        raw: 'XKP9N2V8QT Confirmed. You bought Ksh100.00 of airtime on 17/8/26 at 8:00 AM. New M-PESA balance is Ksh13,980.00.',
    },
    {
        id: 'mpesa-data',
        description: 'M-PESA data bundle purchase',
        raw: 'QPX7K3N9VB Confirmed. You have purchased Ksh1,000.00 SAFARICOM DATA BUNDLES on 16/8/26 at 11:30 AM. New M-PESA balance is Ksh12,980.00.',
    },
    {
        id: 'mpesa-withdrawal',
        description: 'M-PESA agent cash withdrawal',
        raw: 'MKP4X8N2QV Confirmed. Withdraw Ksh5,000.00 from 174646 - TOTAL ENERGIES AGENT NAIROBI on 15/8/26 at 3:00 PM. New M-PESA balance is Ksh7,980.00. Transaction cost, Ksh55.00.',
    },
    {
        id: 'mpesa-ziidi',
        description: 'M-PESA ZIIDI MMF deposit',
        raw: 'ZKX9P3N7VQ Confirmed. Ksh2,000.00 sent to ZIIDI MMF on 14/8/26 at 9:00 AM. New M-PESA balance is Ksh5,980.00.',
    },
    {
        id: 'coop-card-kes',
        description: 'Co-op card payment, KES, DD-MM-YYYY 12h date',
        raw: 'Card PAYMENT of KES 480.00 on NAIVAS LIMITED>Nairobi KE 12-06-2026 10:27 AM Avail Bal KES 45,320.00. Co-operative Bank.',
    },
    {
        id: 'coop-card-usd',
        description: 'Co-op card payment, USD, DD-MMM-YYYY 24h date with seconds',
        raw: 'Card PAYMENT of USD 23.20 on ANTHROPIC* CLAUDE SUB>+14152360599 US 01-JUL-2025 21:59:00 Avail Bal KES 45,320.00. Co-operative Bank.',
    },
    {
        id: 'coop-card-hold',
        description: 'Co-op zero-value authorisation hold, MM/DD/YYYY date',
        raw: 'Card PAYMENT of KES 0.00 on UBER TRIP HELP>San Francisco US 06/17/2026 at 21:13:10 Avail Bal KES 45,320.00. Co-operative Bank.',
    },
    {
        id: 'coop-credit-alert',
        description: 'Co-op M-Pesa credit alert',
        raw: 'Your account has been credited with KES 15,000.00 from JOHN KAMAU on 13-06-2026 09:15 AM. Co-operative Bank. Avail Bal KES 60,320.00.',
    },
    {
        id: 'coop-outgoing-mmdd',
        description: 'Co-op outgoing paybill, MM/DD date',
        raw: 'Ksh8,750.00 sent to MERCY WANJIRU for account 445566 on 06/21/2026 at 4:45 PM. Co-operative Bank. Avail Bal KES 30,000.00.',
    },
    {
        id: 'whatsapp-android-send',
        description: 'WhatsApp Android export prefix around an M-PESA send',
        raw: '[21/08, 21:52] Danny: QGH7XK9P2L Confirmed. Ksh1,000.00 sent to KEVIN ELIJAH 0712345678 on 21/8/26 at 7:38 PM. New M-PESA balance is Ksh15,230.00. Transaction cost, Ksh0.00.',
    },
    {
        id: 'whatsapp-android-receive',
        description: 'WhatsApp Android export prefix around an M-PESA receive',
        raw: '[20/08, 09:10] Danny: RJH2P9XQ7K Confirmed. You have received Ksh2,500.00 from JANE MUTHONI 0798123456 on 20/8/26 at 9:05 AM. New M-PESA balance is Ksh17,730.00.',
    },
    {
        id: 'whatsapp-ios-send',
        description: 'WhatsApp iOS export prefix (seconds, no AM/PM) around an M-PESA send',
        raw: '[19/08/2026, 21:52:00] Danny: UHL7A3OZTN Confirmed. Ksh750.00 sent to MARY ACHIENG 0733445566 on 19/8/26 at 9:52 PM. New M-PESA balance is Ksh6,730.00. Transaction cost, Ksh0.00.',
    },
    {
        id: 'spotify-dup-1',
        description: 'Duplicate Spotify card charge #1 — should collapse with #2 on dedup',
        raw: 'Card PAYMENT of KES 1,190.00 on Spotify P405C0A90E>Stockholm SE 15-06-2026 08:00:00 Avail Bal KES 20,000.00. Co-operative Bank.',
    },
    {
        id: 'spotify-dup-2',
        description: 'Duplicate Spotify card charge #2 — identical, pasted twice',
        raw: 'Card PAYMENT of KES 1,190.00 on Spotify P405C0A90E>Stockholm SE 15-06-2026 08:00:00 Avail Bal KES 20,000.00. Co-operative Bank.',
    },
];

export const ALL_FIXTURES_TEXT = FIXTURES.map(f => f.raw).join('\n\n');
