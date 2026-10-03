# M-Track

**[mtrack-web.vercel.app](https://mtrack-web.vercel.app)**

A private, chat-based tool that turns mobile-money messages, or a plain description of what happened, into documents you can keep, send, or hand to someone.

No accounts. No backend. No server. Everything runs in your browser and stays on your device.

---

## What is M-Track?

In Kenya most money moves through M-Pesa, and the only record is a stream of SMS confirmations. They are hard to total, hard to search, and not something you can hand to a customer, a boss, or an accountant. M-Track takes those messages, or a description when there is no message, and turns them into a proper document.

It is built for three situations:

- **You want to see where your money went.** Paste your messages and get a clean summary.
- **You run a shop or a stand.** A customer asks for a receipt you don't normally give, or you want to log a whole day's sales as they come in and end up with something you can share and analyse.
- **You spent money for someone else.** An errand, a work trip, a shared bill. You need a claim they can read and repay.

### What it deliberately is not

- **Not connected to M-Pesa or any bank.** You paste the message. M-Track never reads your inbox, never logs in anywhere, and cannot move or check money.
- **Not a tax tool.** Every document says it is not a tax invoice, and M-Track never computes tax. Tax invoices come from the supplier's own system.
- **Not an AI chatbot.** The conversation is a set of rules and templates running on your device. There is no language model and no network call. It aims to be genuinely helpful inside one job (recording money) and honest at the edge of it.
- **Not a backup.** There is no sync and no cloud copy. Your data lives in your browser's storage.

---

## The documents

| Document | For |
|---|---|
| **Expense summary** | Your own spending, pulled from pasted messages |
| **Personal note** | A transaction you have no message for, described from memory |
| **Sales receipt** (point of sale) | A shop's receipt for a customer, laid out like a better-organised retail receipt: shop details, itemised lines with quantities, a total with the amount in words, payment details, and who served. Built from the customer's payment message, or typed in for a cash sale. A QR code carries the receipt's facts as plain text, readable offline. It is a convenience, not proof of authenticity |
| **Reimbursement claim** | Money spent on someone else's behalf, presented for repayment. Fees are included in the total, and there is no approval workflow |
| **Day card** | Active Mode's end-of-shift result: a shareable image of the day's sales, plus a sales log and a spreadsheet file |

Every document says how its facts are known, in plain words: "from payment messages" or "entered by hand". Documents never show relative dates like "past 7 days". They show the real date span of what they contain.

You pick a path by talking, not by filling in a form. The bot adapts to whichever is faster: paste a message and it extracts everything, or type a description and it asks only for what is genuinely still missing.

---

## Active Mode

Built for a specific situation: a vendor running M-Track on a device next to their SMS app during a busy shift, logging one sale after another.

- **M-Pesa sales:** paste the payment message, then tap a bucket. Two actions.
- **Cash sales:** tap Cash, pick a bucket, tap an amount. Amount presets come from that day's real sales in that bucket. "Same again" repeats the last entry in one tap, and there is an undo and a list of today's entries.
- Buckets (Combo sales, Drinks, anything) are created on the fly. An Unsorted bucket catches anything not filed, so no sale is lost.
- A lump-sum option is there for cash you didn't log live.
- Nothing is lost if the phone locks, the app is backgrounded, or the tab reloads mid-shift. The screen stays awake while Active Mode is open, on browsers that support it.

Finishing the shift gives you a **day card**: a dark (or light) shareable image with the day's total, the number of sales, the average, the busiest hour or the biggest sale, and a bucket-by-bucket breakdown. Alongside it come a plain **sales log PDF** and a **CSV** for a spreadsheet. Neither contains customer names. Private notes, such as sales still in Unsorted or a balance check that looks off, appear above the card but never inside the image you share.

A day's sales are income, not your spending, so day cards never feed spending insights or all-time totals.

---

## The conversation

The chat is deterministic. A single function, `receive(state, text, ctx)`, takes the conversation state and a message and returns the next state, the bot's turns, and any effects. It lives in `src/lib/conversation/engine.ts`. The chat screen is a thin adapter around it, and the scenario harness drives the same function that ships.

- Asks only what is missing, and never asks again for something already said.
- Understands dates in many forms ("two nights ago", "13 March", "9/2/2026"), rejects future dates and anything over a year old, and always echoes its reading back before saving. A missing date is preferred to a guessed one.
- Locks onto a currency when one is mentioned, reads "100k" and "2k" as amounts, and understands common Swahili and Sheng verbs, numerals and date words in input. Its replies are in English.
- Takes corrections in one step ("no, 600"), handles cancel, and answers help, privacy and "what can you do" questions without losing the conversation.
- At the edge (small talk, advice requests, requests to move money, identity questions) it says plainly what it is and steers back to the job. It never claims to be a person or to do something it cannot.

---

## The parser

M-Track doesn't rely on knowing which bank sent a message. It hunts independently for the fields that matter, such as amount, date, parties, reference code and channel, regardless of format, then classifies, links and reconciles what it finds:

- Handles M-Pesa, Co-operative Bank, M-Pesa GlobalPay virtual card, Airtel Money and T-Kash message shapes, plus Fuliza-backed payments and transaction reversals
- Separates real transactions from account notices and security alerts before they reach extraction
- Merges messages that describe one event from two sources (for example an M-Pesa debit and its card-approval confirmation) without ever calling them duplicates
- Flags genuinely similar-but-distinct transactions as a question, never a silent guess
- Resolves direction (money in or out) from layered evidence: balance arithmetic first, then wording, then sentence structure. It asks rather than assumes when none of that settles it
- Understands multiple currencies in one document and totals them separately

Other banks' alert formats are only partly covered. Full capability and gap analysis: [`PARSER_CAPABILITIES.md`](./PARSER_CAPABILITIES.md).

---

## Installing it

M-Track is a Progressive Web App. There is nothing to download from a store.

- **Android (Chrome, Brave and most others):** open the site, open the browser menu, choose *Install app* or *Add to Home screen*.
- **iPhone (Safari):** open the site, tap Share, then *Add to Home Screen*.

Installed, it gets its own icon, opens without browser chrome, and loads offline.

---

## Reliability

- IndexedDB-backed drafts and history. Leave mid-document and come back later with nothing lost.
- A service worker that always fetches a fresh app shell on navigation, so a deployment can never leave you on a blank page referencing files that no longer exist.
- A PDF layout regression test that measures every string M-Track draws and fails if any two overlap or leave the page. That bug appeared more than once before this guard existed.
- A conversation scenario harness and a browser suite that replay real transcripts from device testing.

---

## Why no backend

Every design decision in this project traces back to one constraint: nothing about a person's financial messages leaves their device. There is no server to breach, no account to compromise, and no customer data to look after.

The trade-off is real: no cross-device sync, no server-side backup, and no push notifications without infrastructure this project has deliberately never taken on. It is intentional, not a limitation waiting to be lifted. The one route to automatic payment capture that doesn't involve reading SMS is Safaricom's Daraja API for business accounts. It needs a registered shortcode and a server, which makes it a different product.

---

## What the installed web app can and can't do

This is an honest accounting of where a PWA stands as of September 2026, set beside what a native app could add. Browser support moves quickly. Check MDN or caniuse.com before building on any row.

| Need | Installed web app (PWA) | Native app |
|---|---|---|
| Own icon, offline use, no browser chrome | Yes, Android and iOS | Yes |
| Receive text shared from another app (Share sheet) | Android Chromium browsers only. **Not on iOS** | Yes, on both |
| Read incoming SMS automatically | No | iOS: not possible. Android: technically possible, but Google Play restricts the SMS permission to a narrow set of apps, so don't count on it |
| Keep the screen on during a shift | Yes (Wake Lock). iOS from 18.4 | Yes, and simpler |
| One-tap paste from the clipboard | Yes, behind a tap, on both | Yes |
| Share a file or image to other apps | Yes (Web Share), on both | Yes |
| Home-screen or lock-screen widget showing the running total | **No** | Yes |
| Reminders and notifications | Needs a server for push. On iOS only for installed apps, and subscriptions need renewing | Local scheduled notifications, no server |
| Number badge on the app icon | Available, not used by M-Track today | Yes |
| Lock the app behind Face ID or fingerprint | No clean standard way | Yes |
| Print straight to a Bluetooth thermal printer | Chrome on Android only (Web Bluetooth). **Not on iOS** | Yes |
| Save exports to a chosen folder | Browser download or the share sheet | Yes |
| Data durability | Browser storage. Clearing site data deletes it, and browsers can evict it. **No backup** | App-private storage that survives until uninstall. Still no backup unless one is built |
| Reliable background work | No | Limited, but real |
| Updates | Instant, on the next load | Store review and release |
| Distribution | A URL or QR code, free | Store listing and reviews, developer accounts and fees |

### What a native wrapper would and wouldn't change

A wrapper such as Capacitor could reuse this React app and add native plugins. Widgets and a share extension still need small pieces of platform-specific code. The honest gains are:

- **Receiving shared messages on iOS**, which closes the one real platform gap in the clipboard-paste workflow
- **A live running-total widget** for Active Mode
- **Direct thermal printing** of the 80 mm receipt
- **A biometric lock** for a tool that holds financial documents
- **More durable storage** than a browser gives
- **Local reminders** with no server
- **A store listing**, with the trust and discoverability that brings

What it would not change: reading M-Pesa messages automatically is restricted by the platforms themselves, not by the web, so a native app would still mostly rely on the user pasting or sharing a message. None of this is committed work. It is kept here so the ceiling of the current architecture is visible.

---

## Tech stack

React + TypeScript + Vite, deployed as a PWA on Vercel. No server, and no database beyond the browser's own IndexedDB. `jsPDF` with embedded fonts for PDF export, and `qrcode` for the receipt QR. Documents are drawn from positioned primitives so the on-screen card, the PNG and the PDF share one layout. Playwright for browser-level testing.

---

## Getting started

```bash
npm install
npm run dev
```

```bash
npm run build   # production build
npm run lint    # eslint
```

---

## Tests

```
npm test        # unit tests (vitest) — fast, no browser, runs anywhere
npm run test:e2e   # browser checks — needs a dev server and a Chromium (see below)
```

`npm test` is the standard run. It covers the parsing pipeline, the conversation scenario harness, document layout (including a standing text-overlap regression test) and Active Mode's session logic, all in plain Node.

### Browser checks (`npm run test:e2e`) — manual / CI-optional

`e2e/` drives the real app in a headless browser. It is **not** part of `npm test`, because it needs two things the unit suite does not:

1. **A running dev server.** Start one first:

   ```bash
   npm run dev                 # then, in another terminal:
   npm run test:e2e
   ```

   It defaults to `http://localhost:5173/`. Vite takes the next free port when that one is busy, so if it did, point the checks at the right one:

   ```bash
   E2E_BASE_URL=http://localhost:5174/ npm run test:e2e
   ```

2. **A Chromium binary.** `playwright-core` is a small dev dependency that ships no browser, so the checks use whichever Chromium is already on the machine: a Playwright-managed one under `~/.cache/ms-playwright`, or an installed Chrome. If there is neither, install one with `npx playwright install chromium`, or point at an existing binary with `CHROME_PATH=/path/to/chrome`.

Both scripts exit non-zero on failure and say exactly what was missing if the server or the browser is not there.

| Script | What it covers |
|---|---|
| `e2e/journey.e2e.mjs` | The full Active Mode journey: HomeScreen → first-run walkthrough with a real practice capture → buckets created on the fly → paste-and-file in two actions → auto-file to Unsorted → duplicate warning → mid-paste reload → Finish, with the on-screen figures checked against the document actually written to IndexedDB. |
| `e2e/buckets.e2e.mjs` | Long-press to rename or delete an Active Mode bucket: that holding a chip opens the menu without also firing the tap that files a sale, that Unsorted has no such menu, and that deleting a bucket with sales in it moves them to Unsorted rather than taking them with it. |
| `e2e/capture.e2e.mjs` | Conversational-capture transcripts from real device testing, replayed through the actual chat: a point-of-sale message containing two priced items (it must not go on to ask what was bought), and a rejected date followed by a fresh ambiguous one (it must be disambiguated, not discarded), plus the retry cap still catching a genuine loop. |
| `e2e/wakeLock.e2e.mjs` | Screen Wake Lock wiring against a stubbed `navigator.wakeLock` that behaves as the spec says a real one does: taken on arrival, re-taken silently after backgrounding, given back on leaving, and absent entirely (indicator and all) where the API is not there. |
| `e2e/paste.e2e.mjs` | The one-tap Paste button in both places it appears, against a stubbed clipboard: that it feeds the same capture path a manual paste does, that a refused clipboard shows one quiet line without blocking the manual fallback, and that it is absent where clipboard reading is unavailable. |
| `e2e/onboarding.e2e.mjs` | That onboarding never describes a capability the device lacks (the walkthrough run with both APIs, neither, and one), plus the composer's Paste tip showing once and never returning. |
| `e2e/viewport.e2e.mjs` | Layout at the constrained sizes Active Mode has to survive (360×400, 640×280 and 360×210, as in split screen with the keyboard open), asserting the paste field, chip row, running total and Finish are all on screen, the `dvh` container tracks the viewport, and the chip row scrolls sideways with its last chip fully reachable. |
| `e2e/cash.e2e.mjs` | Cash sales in Active Mode: the three-tap Cash → bucket → amount flow, presets drawn from the day's real history, "Same again" in one tap, Undo, the entries list, a lump sum, and the CSV export, each checked against the actual stored IndexedDB record. |
| `e2e/dayCard.e2e.mjs` | That finishing a shift lands on the day card (not History), that a customer name never reaches it, that private notes render above it but never inside the exported image, the stall-name edit surviving a reload, the theme toggle, and that Share / Save image / the sales-log PDF / the CSV all actually produce a file. |
| `e2e/receipt.e2e.mjs` | A point-of-sale receipt built through the real "a receipt for a customer" chat conversation, reopened from History onto its own receipt screen: the stable receipt number, the servedBy edit surviving a reload, and that Save image / Save as PDF / Save as web page all actually produce a file. |

These exist because they catch a class of bug the unit suite structurally cannot: wiring. Focus behaviour, persistence timing, app routing after a backgrounded reload, and whether what a vendor sees matches what was saved.

Screenshots land in `e2e/screenshots/` (gitignored).

---

## Project documents

Longer write-ups live at the repo root:

- [`PARSER_CAPABILITIES.md`](./PARSER_CAPABILITIES.md): what the message parser handles, where it is weak, and what it can get wrong
- [`TEST_AUDIT.md`](./TEST_AUDIT.md): an audit of the test suite for assertions that pass without protecting anything
- [`CONVERSATION_REPORT.md`](./CONVERSATION_REPORT.md): the conversation engine, its scenario catalogue, and what it still doesn't cover
- [`DAYCARD_RECEIPT_REPORT.md`](./DAYCARD_RECEIPT_REPORT.md): the day card and sales receipt work, including deviations
- [`DECISIONS.md`](./DECISIONS.md): decisions waiting on the owner, each with the placeholder that ships meanwhile

---

## Status

Active development. The document flow, Active Mode, the conversation engine and the parsing pipeline are stable and covered by unit and browser tests. Visual quality is judged by eye on real phones, because no test can do that. Recent work has focused on real-device bug reports and on closing gaps in the test suite itself. See the commit history for the detailed trail.