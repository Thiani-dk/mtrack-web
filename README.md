# M-Track

**[mtrack-web.vercel.app](https://mtrack-web.vercel.app)**

A chat-based tool for turning transaction messages into documents. Paste an M-Pesa confirmation, a bank alert, or just describe what happened in plain words — M-Track sorts it out and hands back a document you can keep, send, or file.

No accounts. No backend. No server. Everything runs in your browser and stays on your device.

---

## What it does

Four kinds of document come out of the same conversation, depending on what you're actually trying to record:

| Document | For |
|---|---|
| **Expense summary** | Your own spending, pulled from pasted messages |
| **Personal note** | A transaction you have no message for — described from memory |
| **Point of sale** | A receipt a merchant hands a customer, itemised |
| **Reimbursement claim** | Money spent on someone else's behalf, presented for repayment — fees included in the total, no approval workflow required |

You pick a path by talking, not by filling in a form. The bot adapts to whichever is faster: paste a message and it extracts everything, or type a description and it asks only for whatever's genuinely still missing.

### Active Mode

Built for a specific situation: a vendor running M-Track on a device next to their SMS app during a busy shift, logging one sale after another. Paste, tap a category bucket, done — two actions per sale, buckets created on the fly, nothing lost if the phone locks or the tab reloads mid-shift. Ends in a single report with a per-bucket breakdown of the day.

### The parser

M-Track doesn't rely on knowing which bank sent a message. It hunts independently for the fields that matter — amount, date, parties, reference code, channel — regardless of format, then classifies, links, and reconciles what it finds:

- Handles M-Pesa, Co-operative Bank, M-Pesa GlobalPay virtual card, Airtel Money, and T-Kash message shapes, plus Fuliza-backed payments and transaction reversals
- Separates real transactions from account notices and security alerts before either ever reaches extraction
- Merges messages that describe one event from two sources (e.g. an M-Pesa debit and its separate card-approval confirmation) without ever calling them duplicates
- Flags genuinely similar-but-distinct transactions as a question, never a silent guess
- Resolves transaction direction (money in vs out) through layered evidence — balance arithmetic first, then wording, then sentence structure — and asks rather than assumes when none of that resolves it
- Understands multiple currencies in one document and totals them separately rather than combining them into a meaningless figure

Full capability and gap analysis: see [`PARSER_CAPABILITIES.md`](./PARSER_CAPABILITIES.md).

### Reliability

- IndexedDB-backed drafts and history — leave mid-document, come back later, nothing is lost
- A service worker that always fetches a fresh app shell on navigation, so a deployment can never leave you looking at a blank page referencing files that no longer exist
- A dedicated PDF layout regression test that measures every string M-Track draws and fails if any two overlap — this exact bug (text colliding after a long name wraps) has happened more than once and now has a standing guard against it
- Screen Wake Lock in Active Mode, so the screen doesn't dim mid-shift
- One-tap clipboard paste as a fast path alongside manual paste, in both the chat composer and Active Mode

---

## Tech stack

React + TypeScript + Vite, deployed as a PWA on Vercel. No server, no database beyond the browser's own IndexedDB. `jsPDF` with embedded fonts for document export. Playwright for browser-level testing.

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

`npm test` is the standard run. It covers the parsing pipeline, document layout (including a standing text-overlap regression test) and Active Mode's session logic, all in plain Node.

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

2. **A Chromium binary.** `playwright-core` is a small dev dependency that ships no browser, so the checks use whichever Chromium is already on the machine — a Playwright-managed one under `~/.cache/ms-playwright`, or an installed Chrome. If there is neither, install one with `npx playwright install chromium`, or point at an existing binary with `CHROME_PATH=/path/to/chrome`.

Both scripts exit non-zero on failure and say exactly what was missing if the server or the browser is not there.

| Script | What it covers |
|---|---|
| `e2e/journey.e2e.mjs` | The full Active Mode journey: HomeScreen → first-run walkthrough with a real practice capture → buckets created on the fly → paste-and-file in two actions → auto-file to Unsorted → duplicate warning → mid-paste reload → Finish, with the on-screen figures checked against the document actually written to IndexedDB. |
| `e2e/buckets.e2e.mjs` | Long-press to rename or delete an Active Mode bucket: that holding a chip opens the menu without also firing the tap that files a sale, that Unsorted has no such menu, and that deleting a bucket with sales in it moves them to Unsorted rather than taking them with it. |
| `e2e/capture.e2e.mjs` | Two conversational-capture transcripts from real device testing, replayed through the actual chat: a point-of-sale message containing two priced items (it must not go on to ask what was bought), and a rejected date followed by a fresh ambiguous one (it must be disambiguated, not discarded), plus the retry cap still catching a genuine loop. |
| `e2e/wakeLock.e2e.mjs` | Screen Wake Lock wiring against a stubbed `navigator.wakeLock` that behaves as the spec says a real one does: taken on arrival, re-taken silently after backgrounding, given back on leaving, and absent entirely (indicator and all) where the API is not there. |
| `e2e/paste.e2e.mjs` | The one-tap Paste button in both places it appears, against a stubbed clipboard: that it feeds the same capture path a manual paste does, that a refused clipboard shows one quiet line without blocking the manual fallback, and that it is absent where clipboard reading is unavailable. |
| `e2e/onboarding.e2e.mjs` | That onboarding never describes a capability the device lacks — the walkthrough run with both APIs, neither, and one — plus the composer's Paste tip showing once and never returning. |
| `e2e/viewport.e2e.mjs` | Layout at the constrained sizes Active Mode has to survive — 360×400, 640×280 and 360×210 (split screen with the keyboard open) — asserting the paste field, chip row, running total and Finish are all on screen, the `dvh` container tracks the viewport, and the chip row scrolls sideways with its last chip fully reachable. |

These exist because they catch a class of bug the unit suite structurally cannot: wiring. Focus behaviour, persistence timing, app routing after a backgrounded reload, and whether what a vendor sees matches what was saved. Two real bugs found this way — landing on HomeScreen instead of Active Mode after a reload, and the constrained-viewport layout — were invisible to `npm test`.

Screenshots land in `e2e/screenshots/` (gitignored).

---

## Why no backend

Every design decision in this project traces back to one constraint: nothing about a person's financial messages leaves their device. There's no server to breach, no account to compromise, no data-handling license required. The trade-off is real — no cross-device sync, no server-side backup, no push notifications without introducing infrastructure this project has deliberately never taken on. That trade-off is intentional, not a limitation waiting to be lifted.

---

## What native iOS/Android apps would add

M-Track is installable today as a Progressive Web App — add it to your home screen and it behaves like an app: its own icon, offline shell, no browser chrome. Most of what makes M-Track useful is already available that way, on both platforms, without an app store in the loop.

A true native wrapper (React Native, Capacitor, or platform-native Swift/Kotlin) would unlock a specific, honest list of things the web platform genuinely can't do yet, rather than a vague "it'd be better":

- **Reliable share-target on iOS.** Android PWAs can already register as a destination in the native Share sheet — copy a message, tap Share, tap M-Track. iOS has no equivalent for installed web apps; only a true native app can appear there, closing the one real platform gap in the current clipboard-paste workaround.
- **A home-screen or lock-screen widget** showing Active Mode's running total live, without opening the app — genuinely native-only; there's no web API for a persistent glanceable widget.
- **App Store / Play Store discoverability** — a real listing, reviews, and the trust signal of an install button, versus asking someone to type a URL and manually add to home screen.
- **Biometric lock on open** (Face ID / fingerprint) — a meaningful privacy upgrade for a tool that holds financial documents, and something the web platform still can't do cleanly across both ecosystems.
- **Native file system integration** for exports — saving a PDF straight into a chosen folder or sharing sheet, rather than a browser download.
- **True background execution** — a native app doesn't need a Wake Lock workaround to keep a screen alive during a shift; the OS-level equivalent is more reliable and less battery-hungry.
- **Deeper OS integration** — Siri Shortcuts or Google Assistant triggers ("Hey Siri, open Active Mode"), and on iOS specifically, App Clips — a QR code that launches a lightweight, install-free version of M-Track for a single task (imagine scanning a reimbursement claim's QR code and viewing it without installing anything first).

None of this is committed work — it's an honest accounting of the ceiling the current web-only architecture runs into, kept here so the trade-off is visible rather than assumed away.

---

## Status

Active development. The core document flow, Active Mode, and the parsing pipeline are stable and covered by both unit and end-to-end tests. Recent work has focused on real-device bug fixes and closing gaps in test coverage itself — see commit history for the detailed trail.
