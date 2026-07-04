import type {
    DeclutterAnswers,
    DeclutterCommand,
    GmailContent,
    GmailRuthlessness,
} from '../types';

type CommandDraft = Omit<DeclutterCommand, 'id' | 'included'>;

const AGE_BY_RUTHLESSNESS: Record<GmailRuthlessness, string> = {
    light: '1y',
    deep: '6m',
    nuclear: '3m',
};

const AGE_LABEL: Record<string, string> = {
    '3m': '3 months',
    '6m': '6 months',
    '1y': '1 year',
    '2y': '2 years',
    '5y': '5 years',
};

function ageLabel(age: string): string {
    return AGE_LABEL[age] ?? age;
}

function buildExclusions(keepSafe: DeclutterAnswers['keepSafe']): string {
    const parts: string[] = [];
    if (keepSafe.includes('starred')) parts.push('-is:starred');
    if (keepSafe.includes('important')) parts.push('-is:important');
    if (keepSafe.includes('primary')) parts.push('-category:primary');
    return parts.length ? ' ' + parts.join(' ') : '';
}

function shoppingCommands(age: string, excl: string): CommandDraft[] {
    return [
        {
            category: 'Shopping & Offers',
            label: 'Promotions tab cleanup',
            description: `Everything Gmail already tags as Promotions, older than ${ageLabel(age)}`,
            command: `category:promotions older_than:${age}${excl}`,
            estimate: '~200-400 emails',
            irreversible: false,
        },
        {
            category: 'Shopping & Offers',
            label: 'Sale & discount blasts',
            description: 'Subject lines shouting sale, offer, deal or discount',
            command: `subject:(sale OR offer OR deal OR discount OR "% off") older_than:${age}${excl}`,
            estimate: '~50-150 emails',
            irreversible: false,
        },
        {
            category: 'Shopping & Offers',
            label: 'Unread promo blasts',
            description: 'Promotional mail you never even opened',
            command: `category:promotions is:unread older_than:3m${excl}`,
            estimate: '~80-200 emails',
            irreversible: false,
        },
    ];
}

function newsletterCommands(age: string, excl: string): CommandDraft[] {
    return [
        {
            category: 'Newsletters',
            label: 'Unsubscribable senders',
            description: 'Any email carrying an unsubscribe link',
            command: `unsubscribe older_than:${age}${excl}`,
            estimate: '~150-500 emails',
            irreversible: false,
        },
        {
            category: 'Newsletters',
            label: 'Mailing list traffic',
            description: 'Anything sent through a mailing-list header',
            command: `list:* older_than:${age}${excl}`,
            estimate: '~100-300 emails',
            irreversible: false,
        },
        {
            category: 'Newsletters',
            label: 'Digest & roundup emails',
            description: 'Weekly, monthly or digest-style newsletters',
            command: `subject:(newsletter OR digest OR weekly OR monthly OR roundup) older_than:${age}${excl}`,
            estimate: '~60-150 emails',
            irreversible: false,
        },
    ];
}

function socialCommands(age: string, excl: string): CommandDraft[] {
    return [
        {
            category: 'Social Media',
            label: 'Facebook notifications',
            description: 'Friend requests, tags, and activity alerts',
            command: `from:(facebook.com OR facebookmail.com) older_than:${age}${excl}`,
            estimate: '~100-400 emails',
            irreversible: false,
        },
        {
            category: 'Social Media',
            label: 'X / Twitter alerts',
            description: 'Notification emails from X',
            command: `from:(twitter.com OR x.com) older_than:${age}${excl}`,
            estimate: '~50-150 emails',
            irreversible: false,
        },
        {
            category: 'Social Media',
            label: 'LinkedIn notifications',
            description: 'Connection requests and activity digests',
            command: `from:(linkedin.com OR notifications@linkedin.com) older_than:${age}${excl}`,
            estimate: '~80-250 emails',
            irreversible: false,
        },
        {
            category: 'Social Media',
            label: 'Instagram, TikTok & Snapchat',
            description: 'Activity alerts from image and video apps',
            command: `from:(instagram.com OR tiktok.com OR snapchat.com) older_than:${age}${excl}`,
            estimate: '~50-150 emails',
            irreversible: false,
        },
        {
            category: 'Social Media',
            label: 'Everything under Social',
            description: "Gmail's own Social category, in one sweep",
            command: `category:social older_than:${age}${excl}`,
            estimate: '~200-500 emails',
            irreversible: false,
        },
    ];
}

function financialCommands(age: string, excl: string): CommandDraft[] {
    // Financial mail is sensitive by default — never go below 6 months regardless
    // of how ruthless the user says they want to be.
    const financeAge = age === '3m' ? '6m' : age;
    return [
        {
            category: 'Financial & Mobile Money',
            label: 'Old M-PESA notifications',
            description: 'M-PESA confirmation emails, kept for a year minimum',
            command: `subject:("M-PESA" OR "mpesa") older_than:1y${excl}`,
            estimate: '~100-1,000 emails',
            irreversible: false,
        },
        {
            category: 'Financial & Mobile Money',
            label: 'Old receipts & invoices',
            description: 'Purchase receipts and order confirmations',
            command: `subject:(receipt OR invoice OR "order confirmation") older_than:${financeAge}${excl}`,
            estimate: '~100-300 emails',
            irreversible: false,
        },
        {
            category: 'Financial & Mobile Money',
            label: 'Payment provider alerts',
            description: 'Stripe, PayPal, Flutterwave and similar processors',
            command: `from:(stripe.com OR paypal.com OR flutterwave.com) older_than:1y${excl}`,
            estimate: '~50-200 emails',
            irreversible: false,
        },
        {
            category: 'Financial & Mobile Money',
            label: 'Bank statements',
            description: 'Kept for 2 years by default — these matter for records',
            command: `subject:(statement OR "bank statement") older_than:2y${excl}`,
            estimate: '~10-50 emails',
            irreversible: true,
        },
    ];
}

function deliveryCommands(age: string, excl: string): CommandDraft[] {
    return [
        {
            category: 'Deliveries & Orders',
            label: 'Shipping updates',
            description: 'Shipped, out-for-delivery and delivered notices',
            command: `subject:("your order" OR "has been shipped" OR "out for delivery" OR "delivered") older_than:${age}${excl}`,
            estimate: '~100-300 emails',
            irreversible: false,
        },
        {
            category: 'Deliveries & Orders',
            label: 'Order confirmations & tracking',
            description: 'Order confirmations and tracking numbers',
            command: `subject:("order confirmation" OR "tracking number") older_than:${age}${excl}`,
            estimate: '~80-200 emails',
            irreversible: false,
        },
        {
            category: 'Deliveries & Orders',
            label: 'Big retailers',
            description: 'Jumia, Amazon and AliExpress order mail',
            command: `from:(jumia.com OR amazon.com OR aliexpress.com) older_than:${age}${excl}`,
            estimate: '~50-200 emails',
            irreversible: false,
        },
    ];
}

function calendarCommands(age: string, excl: string): CommandDraft[] {
    return [
        {
            category: 'Calendar & Meetings',
            label: 'Old invites',
            description: 'Event and meeting invitations',
            command: `subject:(invitation OR invite OR "you're invited") older_than:${age}${excl}`,
            estimate: '~30-100 emails',
            irreversible: false,
        },
        {
            category: 'Calendar & Meetings',
            label: 'Meeting & calendar mail',
            description: 'General meeting and calendar notifications',
            command: `subject:(meeting OR calendar OR event) older_than:${age}${excl}`,
            estimate: '~50-150 emails',
            irreversible: false,
        },
        {
            category: 'Calendar & Meetings',
            label: 'Old .ics attachments',
            description: 'Calendar file attachments from past events',
            command: `filename:ics older_than:${age}${excl}`,
            estimate: '~20-80 emails',
            irreversible: false,
        },
    ];
}

function workCommands(_age: string, excl: string): CommandDraft[] {
    return [
        {
            category: 'Work & HR Systems',
            label: 'HR platform mail',
            description: 'Workday, BambooHR, Greenhouse, Lever notifications',
            command: `from:(workday.com OR bamboohr.com OR greenhouse.io OR lever.co) older_than:1y${excl}`,
            estimate: '~30-100 emails',
            irreversible: false,
        },
        {
            category: 'Work & HR Systems',
            label: 'Old payslips',
            description: 'Timesheet and payroll mail, kept 2 years minimum',
            command: `subject:(timesheet OR payslip OR payroll) older_than:2y${excl}`,
            estimate: '~10-40 emails',
            irreversible: true,
        },
        {
            category: 'Work & HR Systems',
            label: 'Ticketing system noise',
            description: 'Jira, Confluence and Slack notification mail',
            command: `subject:(ticket OR jira OR confluence OR slack) older_than:1y${excl}`,
            estimate: '~50-200 emails',
            irreversible: false,
        },
    ];
}

function appCommands(age: string, excl: string): CommandDraft[] {
    return [
        {
            category: 'Apps & Games',
            label: 'Achievement & reward spam',
            description: 'Level-ups, badges and in-app reward emails',
            command: `subject:(achievement OR badge OR "level up" OR reward) older_than:${age}${excl}`,
            estimate: '~30-100 emails',
            irreversible: false,
        },
        {
            category: 'Apps & Games',
            label: 'App notification digests',
            description: "Gmail's Updates category — generic app alerts",
            command: `category:updates older_than:${age}${excl}`,
            estimate: '~100-300 emails',
            irreversible: false,
        },
    ];
}

function storageCommands(excl: string, level: 'full' | 'somewhat'): CommandDraft[] {
    const size = level === 'full' ? '5M' : '10M';
    const sizeLabel = level === 'full' ? '5MB' : '10MB';
    return [
        {
            category: 'Storage Hogs',
            label: `Attachments over ${sizeLabel}`,
            description: 'Old large attachments quietly eating your storage quota',
            command: `larger:${size} older_than:1y${excl}`,
            estimate: 'Varies — check size shown in Gmail search results',
            irreversible: true,
        },
        {
            category: 'Storage Hogs',
            label: 'Any attachment, very old',
            description: 'Emails with attachments older than 2 years',
            command: `has:attachment older_than:2y${excl}`,
            estimate: '~50-200 emails',
            irreversible: true,
        },
    ];
}

function universalCommands(excl: string, accountAge: DeclutterAnswers['age']): CommandDraft[] {
    const drafts: CommandDraft[] = [
        {
            category: 'Universal Cleanup',
            label: 'Old unread mail',
            description: "If you haven't read it by now, you probably won't",
            command: `is:unread older_than:1y${excl}`,
            estimate: '~200-1,200+ emails',
            irreversible: false,
        },
        {
            category: 'Universal Cleanup',
            label: 'Trash & Spam sweep',
            description: 'Empty what Gmail already flagged for deletion',
            command: `in:trash OR in:spam`,
            estimate: 'Varies',
            irreversible: true,
        },
    ];

    if (accountAge === '5plus') {
        drafts.push({
            category: 'Universal Cleanup',
            label: 'Truly ancient mail',
            description: 'Anything older than 5 years, excluding what you asked to keep',
            command: `older_than:5y${excl}`,
            estimate: '~500-3,000+ emails',
            irreversible: true,
        });
    }

    return drafts;
}

const CONTENT_BUILDERS: Record<GmailContent, (age: string, excl: string) => CommandDraft[]> = {
    shopping: shoppingCommands,
    newsletters: newsletterCommands,
    social: socialCommands,
    financial: financialCommands,
    delivery: deliveryCommands,
    calendar: calendarCommands,
    work: workCommands,
    apps: appCommands,
};

export function generateDeclutterCommands(answers: DeclutterAnswers): DeclutterCommand[] {
    const age = answers.ruthlessness ? AGE_BY_RUTHLESSNESS[answers.ruthlessness] : '6m';
    const excl = buildExclusions(answers.keepSafe);

    const drafts: CommandDraft[] = [];

    answers.content.forEach((key) => {
        drafts.push(...CONTENT_BUILDERS[key](age, excl));
    });

    if (answers.storage === 'full' || answers.storage === 'somewhat') {
        drafts.push(...storageCommands(excl, answers.storage));
    }

    drafts.push(...universalCommands(excl, answers.age));

    return drafts.map((draft, i) => ({
        ...draft,
        id: `cmd-${i}-${draft.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
        included: true,
    }));
}