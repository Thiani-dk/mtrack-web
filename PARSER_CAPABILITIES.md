# M-Track SMS Parser — Capability Map

**Audit only. No code was changed to produce this document.**

Scope: the pipeline rooted at `src/lib/parsers/parseAllMessages()`, its extractors,
the reconciliation layers (`linkTransactions`, `dedupeTransactions`,
`applyVerificationChargeDetection`, `detectNearDuplicates`, `applyReversalPairs`),
and the user-facing surfacing in `src/lib/parseNotices.ts` +
`src/components/chat/ChatSkippedReview.tsx` + `ChatReceiptVisual.tsx`.

How claims here were checked: I read every file in `src/lib/parsers/` and ran the
live `parseAllMessages` / individual extractors against ad-hoc inputs during this
audit (M-Pesa/Co-op/GlobalPay shapes plus Equity, KCB, betting, M-Shwari, Hustler
Fund, agent deposits, SACCO, NHIF, date-only formats, code-collision cases).
Where I could not confirm real-world message wording (Airtel, T-Kash), I say so.

**There is no committed automated test.** `package.json` has no test runner and
there is no `__tests__` directory. `src/lib/parsers/__fixtures__.ts` exists and its
header says "Used by the verification script", but that script is not in the repo —
verification in prior work was done with throwaway scratchpad scripts. So "has a
fixture" means "a sample string exists in a constant", not "an assertion runs in
CI".

---

## 1. PIPELINE MAP

Raw pasted string → `ParsedTransaction[]`. Every stage, its file, and what it can
silently drop or alter.

### Stage 0 — `parseAllMessages(raw)` — `src/lib/parsers/index.ts:224`
Orchestrator. Returns `{ transactions, stats, skippedMessages, linkEnrichments,
nearDuplicates, reversalPairs }`. Only two call sites in the app:
`ChatScreen.tsx:456` (demo) and `ChatScreen.tsx:839` (real paste). A third call at
`ChatScreen.tsx:828` re-parses the whole string just to check
`.transactions.length === 0` (decide "paste vs typed description") — the string is
parsed twice per send.

### Stage 1 — preprocess → blocks — `src/lib/parsers/preprocess.ts:164` (`preprocessToBlocks`)
Runs in order:

| Step | Function | What it can silently drop / alter |
|---|---|---|
| XML decode | `extractXmlBodies` | If the paste `startsWith('<')` and contains `body=`, ONLY the `body="…"` attributes are kept; **everything outside `body=` attributes is discarded**, and any message whose text is not inside a well-formed `body="…"` is invisible. `stripWhatsApp/Email` are then skipped entirely for XML pastes. |
| WhatsApp prefixes | `stripWhatsAppPrefixes` | Strips a leading `[dd/mm, hh:mm] Name:` per line. A real message body that begins with `[something]:` (≤40 chars before the colon) would be truncated. |
| Email chrome | `stripEmailChrome` | Drops every line matching `^(From|To|Cc|Bcc|Subject|Sent|Date):`, everything after a lone `--` line, and all `<…>` tags. A transaction line beginning `Date: …` or containing `<` would be damaged. |
| Noise lines | `stripNoiseLines` | Deletes the **sentence** (bounded ±300 chars) around 11 trailer phrases, e.g. `amount you can transact within the day is…`, `separate personal and business funds through pochi la biashara`, `never share your … pin`. The regex is `[^.\n]{0,300}<phrase>[^.\n]{0,300}\.?` — if a real payment's data sits in the same unpunctuated run as one of these phrases it is deleted with it. |
| Concatenation repair | `splitConcatenatedMessages` | Inserts `\n\n` before any mid-line `<10-char alnum code> Confirmed` (must contain a letter AND a digit). A legitimate message quoting another code + "Confirmed" would be split in the wrong place. |
| Block split | `splitIntoBlocks` | Splits on blank lines OR a line that "looks like" a new message: a 8–12-char alnum code opener, `Dear/Hello/Hi `, `Ref:`, or a **line starting with `\d{1,2}[/-]\d{1,2}[/-]\d{2,4}`**. A wrapped transaction whose 2nd physical line happens to start with a date fragment is torn into two blocks; the tail becomes an unreadable fragment and the head loses fields. |

**Data-loss points at Stage 1:** XML pastes silently drop non-`body=` content;
noise stripping can eat co-located transaction data; over-eager block splitting
can fragment one transaction into two.

### Stage 2 — classify each block — `src/lib/parsers/classify.ts:58` (`classifyMessage`)
Returns `transaction | service_notice | security_alert | promotional | unknown`.
Order: `NON_TRANSACTION_OVERRIDES` (standalone Fuliza) → `CURRENCY_RE &&
TRANSACTION_VERB_RE` → `SERVICE_NOTICE_PATTERNS` → `SECURITY_ALERT_PATTERNS` →
`unknown`.

- **`TRANSACTION_VERB_RE`** = `sent|paid|payment|received|withdraw|approved|charge(d)?|bought|purchased|credited|debited|deposited|transferred|refund|reversal` + `done at`. **A real transaction whose only verb is outside this list is classified `unknown` and never reaches an extractor.** Confirmed: `Give Ksh2,000 cash to … AGENT` (M-Pesa agent transaction — verb "give" is not in the list) → `unknown` → dropped, even though `parties.ts`, `direction.ts` and `channel.ts` all contain dedicated "Give … cash to" handling that can now never execute.
- `CURRENCY_RE` requires a recognised currency token (`Ksh|KES|USD|EUR|GBP|TZS|UGX|RWF|$|£|€`) immediately before the digits. A message using `KSh` is fine (case-insensitive), but `Shs`, `/=`, `KES.` with a stray char, or a bare number, is not currency and the block is `unknown`.
- Every non-`transaction` block → `notTransactionBlocks` → `skippedMessages` with `reason: 'not-a-transaction'`. **This DOES surface** (skipped-review card + `partial` notice). The code comment at `index.ts:255` ("set aside silently, same as before") is stale.

**Data-loss point at Stage 2:** any real transaction whose verb/currency wording
falls outside the fixed vocab is bucketed as noise. It is recoverable via the
skipped-review "retry / manual entry" UI, but it is not in the totals by default.

### Stage 3 — per-block field extraction — `src/lib/parsers/index.ts:80` (`extractRawBlock`)
Runs all extractors over one block, no judgement. Each is independent:

| Field | File | Silent failure mode |
|---|---|---|
| amount | `extractors/amount.ts` (`extractAmount`) | Scans **all** currency-tagged numbers, scores each by ±40-char context (`POSITIVE_CONTEXT` +2, `NEGATIVE_CONTEXT` −3, near-start +1), returns the highest. On a multi-amount message it can pick a **non-transaction figure** (loan principal, "you saved", "total") and return it at confidence 95 with no flag. Currency is whatever token preceded the winning number; a mixed-token message can mis-tag currency. |
| fee | `extractFee` | First `transaction cost/charge/fee … <number>` only. A second fee, or a fee phrased differently, is lost. |
| balance | `extractBalance` | Captured but not surfaced or used except as `t.balance`. |
| date | `extractors/date.ts` (`extractDate`) | Tries 6 patterns **all of which except `RE_LONGFORM` require a time component**, then an Airtel-ID fallback. **A date with no time (`21/08/2026`, `2026-08-21`, `21-08-2026`, `21.08.2026`, `Aug 21, 2026`) returns `null`.** Also returns `null` if the parsed date is `> now + 1 day` or `< 2007` — an ambiguous slash date that is future under the default DD/MM reading is dropped even when MM/DD would be valid and past. `null` date → the whole transaction fails `finalizeTransaction`. |
| direction | `extractors/direction.ts` (`extractDirection`) | Keyword vote. **If no keyword matches, returns `{ type: 'sent', confidence: 30 }` — a silent guess.** The `confidence` it returns is **never read** by the confidence scorer (see Stage 5). |
| parties | `extractors/parties.ts` (`extractParties`) | 5 recipient regexes + 1 sender regex, each assuming a specific `verb … name … <terminator>` layout. On a layout it doesn't anticipate (e.g. `paid to X from your Bank account Y on …`) the lazy `.+?` over-captures everything up to the first matching terminator → recipient = `"X from your Bank account Y"`. `cleanName` only strips phone numbers and title-cases; it does not reject junk. |
| channel | `extractors/channel.ts` (`extractChannel`) | Provider is the first matching signal or `Unknown`. `method` is a phrase cascade (`card payment` → card, `for account` → paybill, `paid to` → till, …); the first branch to match wins, so a paybill phrased with "paid to", or a till whose text contains "account", flips. |
| cardLast4 | `extractCardLast4` | `card ****1234` only. |
| code | `extractors/code.ts` (`extractCode`) | Labelled ref → leading 10-char code → **first standalone 8–12-char alnum token with a letter and a digit** that isn't a phone/pure-number/currency/`for account` value. On a code-less message it can grab an unrelated token (SKU, URL fragment, location code) and return it as a **non-synthetic** code (`codeIsSynthetic: false` → +10 confidence for a garbage code). If nothing qualifies, a synthetic `AUTO-<djb2(merchant|amount|isoDate)>` is generated. |
| failed | inline regex in `extractRawBlock:96` | `was declined|declined|unsuccessful|failed` anywhere in the block. |

### Stage 4 — link by shared code — `src/lib/parsers/linkTransactions.ts:167` (`linkTransactions`)
Groups `RawBlockResult`s by `codeResult.code`. Groups of 1 pass through. Groups of
2+ with identical text pass through (dedup handles them). Groups of 2+ with
different text are folded into "compatible clusters": two blocks merge if
`amount` matches exactly AND dates are within 10 minutes.

- **Merging is by code string, and the code string can be `AUTO-…`.** Two genuinely different code-less payments of the same amount in the same minute produce the **identical synthetic code**, are grouped, are `areCompatible`, and are **merged into one transaction — one real payment silently deleted.** Confirmed: `Paid Ksh500 to Alice … 2:00 PM` + `Paid Ksh500 to Bob … 2:00 PM` → 1 transaction (recipient "Alice"), and the `linked` notice fires with misleading text (`"1 payments arrived as two messages each. I've combined each pair into one."`).
- Even for legitimate merges, the merged-away block is **not counted anywhere**: `stats.parsed` drops, `stats.rejected` does not rise (it is computed from pre-link block counts). The only trace is the `linkEnrichments` → `linked` notice.
- Field selection in a merge (`pickAmount`/`pickDate`/`pickMerchant`/…) chooses by sub-confidence or "more descriptive"; a wrong sibling can overwrite a right one (e.g. `pickDate` prefers the non-ambiguous date, `pickParties` prefers the longer name).

### Stage 5 — finalise + score — `src/lib/parsers/index.ts:110` (`finalizeTransaction`)
- **Hard requirement: `amount != null && dateResult != null`.** Anything missing either → `return null` → block goes to `unreadableBlocks` → `skippedMessages` (`reason: 'unreadable'`). This is the single biggest silent-exclusion funnel (date-only messages, Equity debits, etc. all die here).
- `displayName` fallback chain: `merchant.name ?? recipient ?? sender ?? fallbackNameForMethod(method) ?? 'Unknown'`.
- **Confidence** (`confidence.ts` `scoreTransaction`): `amount 30 + date 25 + direction 15 + party 15 + code 10 + channel 5`. `amount` and `date` are guaranteed present (else `null` above), and `direction` is **always** `sent` or `received` (never absent), so **every surviving transaction scores ≥ 70**. `applyProviderHint` adds +10 for `^<10-char>\s+Confirmed` matching an M-PESA-tagged block. Level: `≥80 high, ≥75 medium, else low`.
  - To be `low` via score you need **no party AND synthetic code AND provider Unknown+method transfer** — score exactly 70. Any recognised recipient (+15), or any provider/method (+5), or a real-looking code (+10) pushes to ≥75. So the score-based `low` tier is effectively dead for anything that isn't near-total extraction failure.
  - The one live `low` path added in Phase 2: `looksTruncated` (`index.ts:151`) — block ends on a bare letter with no terminal punctuation → `level = 'low'` regardless of score.
- `dateAmbiguous` is a flag on the transaction. **It does not lower the confidence score.** A day/month-flipped date is `high` confidence.
- `direction`'s extractor confidence (30 for a guess vs 95 for a certainty) is **discarded** — `scoreTransaction` only checks `t.type` is one of two enum values, which is always true.
- Fuliza portion captured to `fulizaAmount` (regex `Fuliza M-PESA amount is Ksh <n>`); `reversalOf` captured (`Reversal of transaction <CODE>`). Neither is rendered anywhere.

### Stage 6 — verification charges — `src/lib/parsers/verificationCharge.ts`
`applyVerificationChargeDetection`: sets `isVerificationCharge` on a transaction if
`amount ≤ 5`, there is an opposite-direction transaction of the **exact same
amount** within **5 minutes**, AND `/GlobalPay|Virtual/i` appears in one side's
`rawLine` or merchant. Does **not** exclude — only flags. Exclusion happens later
in `ChatScreen.tsx:841` (`t.isHold || t.failed || t.isVerificationCharge → excludedFromReceipt`).

### Stage 7 — dedup — `src/lib/parsers/preprocess.ts:186` (`dedupeTransactions`)
Key: `` `${code}|${amount}|${floor(dateMs/60000)}` ``. Keeps first, `removed[]`
surfaces as `skippedMessages` (`reason: 'duplicate'`) + `dupes` notice. Two
genuinely-distinct transactions that collide on all three fields → one silently
labelled a duplicate (rare for real M-Pesa; possible for synthetic-code inputs).

### Stage 8 — reversal pairs — `src/lib/parsers/reversals.ts:15` (`applyReversalPairs`)
For each transaction with `reversalOf` set, if a transaction with that code is
also in the batch, both get `isReversed = true` + `excludedFromReceipt = true`.
Surfaces via `reversal` notice AND (because `excludedFromReceipt` is set inside
`parseAllMessages`) the skipped-review card. A reversal whose original is **not**
in the batch is left as a plain `received` transaction — see §3.

### Stage 9 — near-duplicates — `src/lib/parsers/nearDuplicates.ts:28` (`detectNearDuplicates`)
Flags a pair (different codes, same `normalizeParty(merchant ?? recipient)`, ≤15
min apart, equal amounts OR one `< 5` and the other not). **Never removes** —
surfaces only as a tappable "keep both / drop the small one" question. Requires a
non-empty normalised party on both sides, so two code-less payments to unnamed
recipients (`recipient: 'Unknown'` → `normalizeParty` = `''`) are **not** compared.

### Stage 10 — stats + return
`stats.parsed` = final unique count. `stats.rejected` = `(totalBlocks −
transactionBlocks) + failedToFinalize`. **Merged-away blocks are in neither.**
`byConfidence` tallied from `confidenceLevel`.

### Stage 11 — surfacing — `src/lib/parseNotices.ts` + `ChatScreen.deliverInsights`
`buildParseNotices` turns `stats` + the four reconciliation arrays into bubbles.
`skippedMessages` becomes one collapsible "skipped-review" card. See §4 for the
full silent/surfaced table.

**Bypass path:** `conversationalCapture.ts` and `ChatSkippedReview.tsx` call
`extractRawBlock` + `finalizeTransaction` **directly**, skipping classify, link,
dedup, verification, near-dup and reversal detection. Typed descriptions and
single-block manual retries get none of the reconciliation layers.

---

## 2. WHAT IT HANDLES WELL

"Fixture" = a constant in `__fixtures__.ts`. "Verified" = I ran it through
`parseAllMessages` during this audit or a prior phase and confirmed the output.
**No fixture has been checked against a genuine device SMS** — they are all
hand-authored plausible shapes.

### M-Pesa (Safaricom)

| Case | Fixture | Confidence |
|---|---|---|
| P2P send (`Ksh X sent to NAME PHONE on dd/m/yy at h:mm PM`) | `mpesa-send` | Verified. Solid — this is the format the whole parser is built around. |
| P2P receive (`You have received Ksh X from NAME PHONE`) | `mpesa-receive` | Verified. |
| Paybill with account (`sent to BIZ for account N`) | `mpesa-paybill` | Verified. `method: paybill`, account captured. |
| Till / Buy Goods (`paid to BIZ.`) | `mpesa-till` | Verified. `method: till`. Falls back to the bare till number as the name when no business name is present (`paid to 5678910.` → recipient `"5678910"`). |
| Airtime (`You bought Ksh X of airtime`) | `mpesa-airtime` | Verified. |
| Data bundles (`purchased Ksh X SAFARICOM DATA BUNDLES`) | `mpesa-data` | Verified. |
| Agent **withdrawal** (`Withdraw Ksh X from AGENT`) | `mpesa-withdrawal` | Verified. `subType: withdrawal`. |
| Ziidi / M-Shwari **deposit** (`sent to ZIIDI MMF` / `transferred to M-Shwari`) | `mpesa-ziidi` | Verified for the deposit direction. `subType: investment`/`mshwari`, excluded from `trueOutflow`. |
| Fuliza-backed payment — amount = the sent amount, not the Fuliza figure | `FULIZA_PAYMENT` | Verified (Phase 2). `fulizaAmount` captured. `Fuliza`/`outstanding`/`interest` are `NEGATIVE_CONTEXT` for the amount scorer. |
| Standalone Fuliza facility notice → `service_notice` | `FULIZA_STANDALONE_NOTICE` | Verified. Pre-check in `classify.ts` runs before the currency+verb test. |
| Balance enquiry / "added X to contacts" / "statement is ready" → `service_notice` | `BALANCE_ENQUIRY`, `CONTACT_ADDED`, `STATEMENT_READY` | Verified. Confirmed these patterns do **not** misfire on a real send that happens to contain "Your M-PESA balance is". |
| Reversal message → `received` + `reversalOf` captured | `REVERSAL_MESSAGE` | Verified. |
| Reversal **pair** (original + reversal both pasted) → both excluded, explained | `REVERSAL_ORIGINAL` + `REVERSAL_MESSAGE` | Verified. |
| International remittance **inflow** (arrives as a normal M-Pesa credit, e.g. `received Ksh X from WORLDREMIT`) | none | Verified ad-hoc. Parses correctly as a `received` — nothing special needed because it *is* a normal receive. |
| SACCO / NHIF-SHA / school-fees paybills | none | Verified ad-hoc — these are ordinary paybills and parse fine. |

### Co-operative Bank

| Case | Fixture | Confidence |
|---|---|---|
| Card payment KES (`Card PAYMENT of KES X on MERCHANT>LOCATION dd-mm-yyyy h:mm AM`) | `coop-card-kes` | Verified. |
| Card payment USD, `dd-MMM-yyyy HH:mm:ss` | `coop-card-usd` | Verified. Currency retained as USD. |
| Card payment, US-style `MM/DD/YYYY` | `coop-card-hold` | Verified — disambiguates because 06/17 → day 17. |
| Zero-value authorisation hold (`KES 0.00`) → `isHold`, excluded | `coop-card-hold` | Verified. |
| M-Pesa credit alert (`Your account has been credited with KES X from NAME`) | `coop-credit-alert` | Verified. |
| Outgoing paybill, `MM/DD` date | `coop-outgoing-mmdd` | Verified. |
| Alternate card wording (`Card PAYMENT transaction dated <date> of <CUR> <n> MERCHANT>LOC Was Successful`) | `USD_CARD_PAYMENT` | Verified (Phase 2 added `CARD_ALT_RE`). |

### M-Pesa GlobalPay virtual card

| Case | Fixture | Confidence |
|---|---|---|
| M-Pesa debit SMS + card-approval SMS sharing a code → merged into one, merchant name recovered from the card side | `globalpay-glovo-linking` | Verified. |
| Padded fixed-width merchant blob (`PWL*Glovo⎵⎵⎵Nairobi⎵⎵⎵KE`) → clean name + `"City, CC"` location | `globalpay-glovo-linking` | Verified. `merchant.ts` `PADDED_BLOB_RE`. |
| GlobalPay account-management notices (suspended/unsuspended/created/registered/viewed) → `service_notice` | `globalpay-glovo-linking` (5 of them) | Verified. |
| GlobalPay Ksh 1 verification charge pair → flagged + excluded + explained | `globalpay-glovo-linking` | Verified. **Gated on `/GlobalPay|Virtual/` — see §3.** |

### Airtel Money / T-Kash

| Case | Fixture | Confidence |
|---|---|---|
| Airtel send (`You have sent Ksh X to NAME PHONE … Transaction ID: PP…`) | `AIRTEL_SEND` | Verified against the fixture. **The fixture wording is my own guess at Airtel's format — not confirmed against a real Airtel SMS.** |
| Airtel receive with **no explicit date** → date derived from the `PPyymmdd` transaction ID | `AIRTEL_RECEIVE` | Verified against the fixture. **The assumption that Airtel IDs encode `yymmdd` in positions 3–8 is unverified — I have not seen a real Airtel ID.** `date.ts:33` `RE_AIRTEL_ID`. |
| T-Kash send (`You have sent KSH X to NAME PHONE … Ref: TK…`) | `TKASH_SEND` | Verified against the fixture. **Fixture wording unverified against a real T-Kash SMS.** |
| Provider detection for Airtel (dotted ID) / T-Kash (`Ref: TK…`) when the brand word is absent | — | Verified against fixtures only. |

### Generic / structural

| Case | Fixture | Confidence |
|---|---|---|
| WhatsApp Android export prefix `[dd/mm, hh:mm] Name:` | `whatsapp-android-send/receive` | Verified. |
| WhatsApp iOS export prefix `[dd/mm/yyyy, hh:mm:ss] Name:` | `whatsapp-ios-send` | Verified. |
| SMS Backup & Restore XML (`<sms body="…"/>`) | none | Verified ad-hoc — bodies are extracted. **Anything outside `body=` is dropped (§1).** |
| Exact-duplicate paste (same code + amount + minute) → deduped, counted, explained | `spotify-dup-1` + `spotify-dup-2` | Verified. |
| Near-duplicate (same party, minutes apart, one tiny amount) → question | proven by `globalpay-glovo-linking` (Ksh 816 / Ksh 1 Glovo pair) | Verified. |
| Truncated mid-sentence but amount+date present → kept, forced `low` | `TRUNCATED_MESSAGE` | Verified (Phase 2). |
| Truncated with no usable fields → `unreadable`, surfaced | `TRUNCATED_UNREADABLE` | Verified. |
| Two messages concatenated with no separator → split on the mid-line code | `CONCATENATED_PAIR` | Verified. Only works when the second message opens with a **10-char** code + `Confirmed`. |
| Multi-currency document → per-currency subtotals in chat/HTML/PDF, "totalled separately" notice | `USD_CARD_PAYMENT` + any KES | Verified (Phase 2). `computeReceiptData.isMultiCurrency`. |

---

## 3. WHAT IT HANDLES POORLY OR NOT AT ALL

### 3a. Real Kenyan message shapes with no extractor / fixture

Confirmed by running representative wording through `parseAllMessages` during this
audit.

| Shape | What happens now | How confirmed |
|---|---|---|
| **Equity Bank** debit/credit alert (`Ksh X debited from your Equity Bank account … on 21/08/2026 for payment to KPLC. Ref …`) | **Dropped entirely** — `21/08/2026` has no time → `extractDate` returns `null` → `unreadable`. | Ran it: `1 block → 0 transactions, skipped: ['unreadable']`. |
| **KCB** paybill (`KES X paid to KPLC from your KCB account xxxx1234 on 21-08-2026 14:03`) | Parses but recipient = `"KPLC from your KCB account xxxx1234"` (over-capture), `confidence: 100/high`. | Ran it — see output in §5 #7. |
| **KCB M-PESA** loan disbursement (`Ksh X from KCB M-PESA account has been credited to your M-PESA account`) | Parsed as `type: received`, `subType: person_receive` → **counted as income** in `totalReceived`. | Ran it. |
| **M-Shwari loan** disbursement / **repayment** | Disbursement: `transferred from M-Shwari … to M-PESA` → `type: sent`, `subType: mshwari` → excluded from `trueOutflow` (loan money in, shown as neither in nor out). Repayment (`sent to M-Shwari`) → `mshwari` → **excluded from spend totals** even though real cash left. | Ran it. |
| **Hustler Fund** loan (`You have received Ksh X Hustler Fund loan`) | `type: received`, recipient `"Unknown"`, `confidence: 85/high`, synthetic code → **counted as income from nobody**. | Ran it. |
| **Agent deposit / "Give cash to"** | `classifyMessage` → `unknown` (verb "give" not in `TRANSACTION_VERB_RE`) → dropped as not-a-transaction, despite dead handling code for it in `parties/direction/channel`. | Ran it: `0 transactions, skipped: ['not-a-transaction']`. |
| **Absa, NCBA (incl. LOOP), Stanbic, DTB, Family Bank, I&M, Sidian, Gulf African, Standard Chartered, Equitel** | `channel.ts` has a **provider-name signal only** (`\bNCBA\b`, `Stanbic`, …). There is **no recipient/date/amount pattern** tuned for any of them. They parse only insofar as their wording coincidentally matches the M-Pesa/Co-op patterns; date-only formats (common on bank alerts) drop them. | Provider list in `channel.ts:26-37`; zero corresponding patterns in `parties.ts`/`date.ts`; no fixtures. |
| **Betting platforms** (SportPesa/Betika/1xBet/Odibets deposits & withdrawals) | Parse as ordinary paybill/receive **if** phrased like M-Pesa. No category, no special handling; a withdrawal reads as generic income, a deposit as generic spend. | Ran SportPesa/Betika — parse, uncategorised. |
| **Pochi la Biashara** receive (`received Ksh X from NAME for your business`) | recipient captured as `"NAME for your business"` (`for your business` not a terminator). | Ran it. |
| **Lipa na M-Pesa** with only a till number (no business name) | recipient = the bare number. | Ran it. |
| **International remittance send** (WorldRemit/Remitly/Sendwave) | N/A — the user never receives an SMS for the *send*; the *inflow* to their M-Pesa parses fine as a receive. Not a gap. | — |
| **SACCO / insurance** paybills | Parse fine (ordinary paybills). Not a gap; listed for completeness. | Ran STIMA SACCO, SHA. |
| **Date-only formats** (`dd/mm/yyyy`, `yyyy-mm-dd`, `dd-mm-yyyy`, `dd.mm.yyyy`, `Mon DD, YYYY`) — **any provider** | `extractDate` → `null` → transaction dropped as `unreadable`. Only `RE_LONGFORM` (`21 Aug 2026`) survives without a time. | Ran all 6 formats: only `21 Aug 2026` / `21st August 2026` return a date. |

### 3b. Structural weaknesses in the extractors

- **`date.ts` — five of six patterns require a time component.** `RE_SLASH`,
  `RE_DASH_MMM`, `RE_DASH_NUMERIC`, `RE_ISO` all end with a mandatory `HH:MM`.
  This is an M-Pesa assumption ("… on 21/8/26 at 7:38 PM"). Bank and service
  alerts frequently omit the clock. See 3a.
- **`date.ts` — ambiguous-date rejection is one-directional.** `resolveSlashComponents`
  defaults `a/b` (both ≤12) to DD/MM. If that reading is `> now + 1 day`,
  `extractDate` returns `null` — it never tries the MM/DD reading, which may be
  valid and in the past. Confirmed: `03/12/26` → `null` (today 2026-09-08).
  This bug's blast radius **grows through the calendar year**.
- **`direction.ts` — silent default and discarded confidence.** No keyword →
  `{ type: 'sent', confidence: 30 }`. The `confidence` field is never consumed
  (`confidence.ts` scores `t.type` being one of two enum values → always +15).
  So "we guessed sent" and "we are certain it's sent" are indistinguishable
  downstream. Confirmed with 4 received-shaped phrasings that all returned
  `sent/30`.
- **`amount.ts` — a ±40-char context heuristic decides which number is "the
  amount".** `POSITIVE_CONTEXT` includes the single word `of`, which sits near a
  huge range of non-transaction figures ("balance of", "loan of", "fee of").
  `NEGATIVE_CONTEXT` is a fixed 9-phrase list; anything it doesn't list
  (`repay`, `saved`, `cashback`, `reward`, `owe`, `limit increased to`) does not
  suppress a wrong candidate. On a message with several amounts and weak positive
  context on the real one, it picks wrong at up to confidence 95.
- **`parties.ts` — every pattern hard-codes a `verb … NAME … <one of ~6 terminators>`
  shape.** The lazy `(.+?)` plus a terminator list that assumes the name is
  immediately followed by `for account` / `on <date>` / `.` means any interposed
  clause (`from your Bank account`, `via API`, `Ref …` without a colon, a second
  phone number, `for your business`) gets swallowed into the name. `cleanName`
  does not validate — it strips phones and title-cases, nothing else.
- **`code.ts` — `STANDALONE_RE` will label a non-code token as a real code.**
  For a code-less message it returns the first 8–12-char alnum token containing a
  letter and a digit that isn't a phone/number/currency. This produces
  `codeIsSynthetic: false` (a "found" code) which then earns +10 confidence, and
  feeds `dedupeTransactions` / `linkTransactions` keys with garbage.
- **`channel.ts` — provider signals are brand-word matches; method is a
  first-match phrase cascade.** No structural understanding — a paybill that says
  "paid to" becomes a till; a till whose merchant name contains "account" (e.g.
  "ACCOUNT PLUS HARDWARE") becomes a paybill.
- **`classify.ts` — fixed verb/currency vocab is the gate.** Every real
  transaction whose wording is outside `TRANSACTION_VERB_RE` +
  `CURRENCY_RE` is invisible to extraction. "give", "reversed to", "top-up",
  "loaded", "cash out", "disbursed", `Shs`, `/=` are all outside it.
- **`linkTransactions.ts` — merges by code string, synthetic codes included, on
  a loose amount+10-min compatibility test.** See 3c.
- **`confidence.ts` — rewards field *presence*, not field *correctness*.** A
  confidently-wrong recipient scores the same +15 as a correct one. `dateAmbiguous`
  costs nothing. The score-based `low` tier is unreachable for any transaction
  with a recognised party or channel (§1 Stage 5).

### 3c. Plausible-but-WRONG results (fail dirty, not clean)

These are the dangerous ones — a `ParsedTransaction` is produced, usually at
`high` confidence, with no flag, and it is wrong.

1. **Direction flip.** Received → recorded `sent` whenever the message lacks an
   exact direction keyword. `Ksh X to your wallet from ACME` → `sent`. On an
   expense summary or claim this turns an inflow into an outflow. Confirmed.
2. **Wrong amount from a multi-amount message.** `Loan of Ksh5,000 approved. Repay
   Ksh5,750.` → amount `5000` at confidence 95. Any "you paid X, you saved Y",
   "total including fee", cashback, or split-bill message is exposed. Confirmed
   the mechanism; the exact victim depends on wording.
3. **Synthetic-code collision merge — a whole transaction deleted.** Two code-less
   same-amount same-minute payments → 1 transaction, the other silently gone, and
   the `linked` notice says it merely "combined two messages". Confirmed
   (Alice/Bob → 1). This is a **silent total loss dressed as a benign merge.**
4. **Recipient over-capture.** KCB `paid to KPLC from your KCB account xxxx1234` →
   recipient `"KPLC from your KCB account xxxx1234"`. On a customer-facing receipt
   or a reimbursement line this prints as the payee. Confirmed.
5. **Loan disbursement counted as income.** KCB M-PESA / Hustler Fund loan
   credits land in `totalReceived`. On an expense summary the user's "money in"
   is inflated by borrowed money. Confirmed.
6. **Loan/savings repayment excluded from spend.** `sent to M-Shwari` /
   `sent to KCB M-PESA` → `subType: mshwari`/`investment` → subtracted out of
   `trueOutflow`. Real cash left the wallet; the summary says it didn't.
   Confirmed via `computeReceiptData` (`trueOutflow = totalSent − mshwariTotal −
   investmentTotal`).
7. **Lone reversal reads as generic income.** A reversal SMS pasted without its
   original → `type: received`, recipient `"Unknown"`, confidence 100. It is a
   refund of the user's own earlier payment, shown as income from nobody. The
   captured `reversalOf` code is ignored when the original isn't present.
   Confirmed.
8. **Currency mis-tag on a mixed-token line.** `extractAmount` tags the winning
   number with whatever currency token preceded it. A line like
   `USD 20 (KES 2,600) charged` could return either. Not confirmed against a real
   message — **unsure** how often this shape occurs — but the mechanism is real.
9. **Ambiguous date silently uses the wrong reading.** When both readings are in
   the past, `resolveSlashComponents` picks DD/MM and only sets `ambiguous: true`
   (a flag most UI never shows — §4). `05/03/26` → 5 March, not 3 May, with no
   visible warning on the transaction row.
10. **Garbage token used as transaction code** → breaks dedup (a real duplicate
    won't collapse) or causes a false dedup/merge. Silent.

### 3d. The confidence-scorer question (from the earlier finding)

**Still true, and worse than "nearly unreachable".** Floor is 70 (amount 30 +
date 25 + direction 15, all guaranteed). Thresholds: `≥80 high`, `≥75 medium`,
`<75 low`. The only components above the floor are party (15), code (10),
channel (5), hint (10). So:

- party present → ≥85 → `high`
- code real → ≥80 → `high`
- channel known (any provider OR any non-`transfer` method) → 75 → `medium`
- none of the above → exactly 70 → `low`

`low` via score therefore requires *simultaneous* failure of party, code and
channel — i.e. the extractor found essentially nothing but an amount and a date.
Every real M-Pesa message clears `high` trivially. The **only** realistically
reachable `low` is the Phase-2 `looksTruncated` override.

Things the scorer **cannot distinguish**, all confirmed by reading `confidence.ts`
+ `direction.ts`:

- guessed direction (extractor conf 30) vs certain direction (conf 95) — both +15
- correct recipient vs junk over-captured recipient — both +15
- ambiguous date vs unambiguous date — both +25, no penalty for `dateAmbiguous`
- a real 10-char code vs a random token that happened to look code-shaped — both
  `codeIsSynthetic: false` → both +10
- amount picked with strong context (conf 95) vs amount picked as the least-bad of
  several (conf 60) — both +30

The `amount`/`date`/`direction` sub-confidences produced by the extractors are
**thrown away**; only `t.type`/`t.amount`/`t.date` *existing* is scored.

---

## 4. SILENT FAILURE AUDIT

Every place a transaction can be dropped / merged / excluded / altered, and
whether the user is told.

| Event | Where | Surfaced? |
|---|---|---|
| Block classified `service_notice` | `index.ts:243` | **Surfaced** — `card-notices` notice + skipped-review card. |
| Block classified `security_alert` / `promotional` / `unknown` | `index.ts:249-257` | **Surfaced** — counted in `stats.rejected` → `partial` notice + skipped-review (`reason: 'not-a-transaction'`). |
| `finalizeTransaction` returns `null` (missing amount or date, or score < 40) | `index.ts:114,145` | **Surfaced** as a count — `partial` notice + skipped-review (`reason: 'unreadable'`). **The *reason* is not surfaced** — the user cannot tell "this had no time on the date" from "this was gibberish". |
| Date parsed but rejected as future / pre-2007 | `date.ts:141-142` | **Invisible as a cause.** Downstream it becomes an `unreadable` block; the user sees "1 message didn't look like a transaction", never "the date read as the future". |
| Ambiguous slash date, DD/MM reading used | `date.ts` `resolveSlashComponents` | **Aggregate only** — `ambiguous` notice ("I've gone day-first… worth a glance"). **Not shown on the transaction row** — `ChatReceiptVisual` never renders `dateAmbiguous` for a parsed batch. |
| Direction defaulted to `sent` (no keyword) | `direction.ts:47` | **Invisible.** No notice, no flag, no confidence penalty. |
| Amount extractor picked the wrong candidate | `amount.ts:54` | **Invisible.** Result is a normal transaction, usually `high`. |
| Recipient/merchant over-captured | `parties.ts` | **Invisible.** Prints as-is on the receipt. |
| Non-code token used as transaction code | `code.ts:55-68` | **Invisible.** |
| Two blocks **merged** by shared code (legitimate split-message) | `linkTransactions.ts` | **Surfaced** — `linked` notice. But the notice text can be grammatically broken (`"1 payments arrived as two messages each"`). |
| Two **distinct** transactions merged (synthetic-code collision) | `linkTransactions.ts` | **Surfaced as the wrong thing** — the same `linked` "I combined two messages" notice fires; the user has no reason to think a payment was lost. Effectively invisible. |
| Merge field-selection overwrote a correct field with a sibling's wrong one | `linkTransactions.ts` `pick*` | **Invisible.** |
| Duplicate removed (`code+amount+minute` match) | `preprocess.ts:196` | **Surfaced** — `dupes` notice + skipped-review (`reason: 'duplicate'`). Mislabels a genuine distinct collision as a "duplicate". |
| Verification charge flagged & excluded | Stage 6 + `ChatScreen.tsx:841` | **Surfaced** — `verification` notice + skipped-review. **Only for GlobalPay/Virtual-tagged text** — a bank 3DS test charge is not caught and counts as a real payment. |
| Hold (`amount 0`) excluded | `index.ts:154` + `ChatScreen.tsx:841` | **Surfaced** — `holdsfailed` notice + skipped-review. |
| Failed payment (`declined/unsuccessful`) excluded | `extractRawBlock:96` + `ChatScreen.tsx:841` | **Surfaced** — `holdsfailed` notice + skipped-review. |
| Reversal pair excluded (both sides) | Stage 8 | **Surfaced** — `reversal` notice + skipped-review. |
| Lone reversal (original absent) kept as `received` income | Stage 8 (no pair) | **Invisible** — looks like a normal Ksh-X receive from "Unknown". |
| Near-duplicate flagged | Stage 9 | **Surfaced** — tappable question. Not fired if either party normalises to `''`. |
| Loan disbursement counted as `received`; repayment excluded from `trueOutflow` | `deriveSubType` + `computeReceiptData` | **Invisible.** No notice, no subType the user would recognise as "loan". |
| `stripNoiseLines` deleted a sentence that contained transaction data | `preprocess.ts:91` | **Invisible.** |
| XML paste: content outside `body="…"` discarded | `preprocess.ts:8` | **Invisible.** |
| Block split mis-fired (wrapped line began with a date/`Dear`/code) | `preprocess.ts:125` | **Invisible** for the head (loses fields); the tail usually surfaces as `unreadable`. |
| `low` confidence assigned | Stage 5 | Notice `lowconf` says *"they're marked so you can check them"* — **but nothing marks them.** `ChatReceiptVisual` / the downloaded PDF/HTML do not render `confidenceLevel` at all. The safety net is a claim with no implementation. |
| `missingFields` list | `confidence.ts` | **Never surfaced anywhere.** |
| `fulizaAmount`, `balance`, `cardLast4`, `reversalOf` | captured | **Never rendered** (design choice, not a bug — but `reversalOf` on a lone reversal is a missed opportunity, see §3c #7). |

**Net:** the deterministic exclusions (service notice, unreadable count, dupes,
holds, failed, verification, reversal pair, near-dup, link) are all narrated. The
**value-corrupting** events — wrong direction, wrong amount, wrong recipient,
collision-merge deletion, loan misclassification, ambiguous-date misread — are
all invisible, and the one generic safety valve (`low`-confidence marking) is not
wired to any UI.

---

## 5. ACCURACY RISKS RANKED

Damage = money misrepresented on a document the user acts on (a claim, an expense
summary, a customer receipt). Ordered worst first.

| # | Risk | Why it ranks here |
|---|---|---|
| 1 | **Direction defaults to `sent` when no keyword matches; the extractor's own low confidence is discarded.** (`direction.ts:47`, `confidence.ts`) | Turns an inflow into an outflow — a 200% directional error — silently, at `high` confidence. Triggers on every non-M-Pesa "received" wording (Equity, KCB, Hustler Fund partial, banks generally). On a reimbursement claim this both overstates what is owed and hides a receipt. |
| 2 | **Wrong amount chosen from a multi-amount message, high confidence, no flag.** (`amount.ts`) | Wrong money on the document, directly. The `NEGATIVE_CONTEXT` list is fixed and short; Fuliza was patched by hand, but loan/cashback/"total incl. fee"/split-bill messages are not covered. The user has no signal to re-check. |
| 3 | **Date-only messages (no time) are dropped entirely as `unreadable`, reason hidden.** (`date.ts`) | A whole transaction vanishes from the total. Extremely common outside M-Pesa (bank debit alerts routinely omit the clock). The user is told "1 message didn't look like a transaction" — they will not go re-add a payment they can't see. |
| 4 | **Loan disbursements counted as income; loan/savings repayments excluded from spend.** (`deriveSubType`, `computeReceiptData`) | Fuliza, KCB M-PESA, M-Shwari and Hustler Fund are used by a large share of M-Pesa users. Borrowed money inflates "received"; repayments deflate "spent". The bottom-line position on an expense summary is materially wrong in both directions at once. |
| 5 | **Synthetic-code collision merge silently deletes a real transaction, narrated as a benign "I combined two messages".** (`linkTransactions.ts`) | Total loss of a payment from the document. Lower trigger frequency (needs code-less input — typed descriptions, cash entries) but zero chance of the user noticing, and the misleading notice actively reassures them. |
| 6 | **Confidence / ambiguity is computed but never shown per transaction; the `lowconf` notice claims rows are "marked" when they are not.** (`ChatReceiptVisual`, `parseNotices.ts` `lowconf`) | This is the meta-risk: it removes the user's ability to catch #1, #2, #7, #9 themselves. A tool whose job is accuracy tells the user "check the marked ones" and marks nothing. |
| 7 | **Recipient over-capture on any non-M-Pesa layout.** (`parties.ts`) | `"KPLC from your KCB account xxxx1234"` prints verbatim as the payee on a customer receipt or a claim line. Not wrong *money*, but wrong *record* on a document someone else reads and may dispute. |
| 8 | **Ambiguous slash date that is future under DD/MM is dropped (never tries MM/DD); worsens as the year progresses.** (`date.ts`) | Whole transaction lost as `unreadable`, seasonally. By Q4 a growing band of legitimate `dd/mm` dates with day ≤ 12 fail. |
| 9 | **Entire Equity Bank format unsupported; other bank formats (KCB, Absa, NCBA, Stanbic, DTB, Family Bank, Equitel, StanChart) have a provider name signal but no field patterns.** (`channel.ts` vs `parties.ts`/`date.ts`) | For a user who banks with Equity, card and account activity produces **nothing**. For the others, results depend on accidental overlap with M-Pesa wording plus the date-only problem (#3). |
| 10 | **Verification-charge, near-duplicate and reversal safeguards are M-Pesa/GlobalPay-shaped or require both sides present.** (`verificationCharge.ts` `/GlobalPay|Virtual/` gate; `nearDuplicates.ts` empty-party skip; `reversals.ts` pair requirement) | Bank card 3DS test charges (Ksh 1–5) count as real payments; a lone reversal reads as income; code-less near-duplicates aren't compared. Individually small money, but each is a case the tool is *supposed* to catch and doesn't outside Safaricom's ecosystem. |

Not ranked but worth noting: **no committed automated test** means any of the
above can silently regress on the next change, and the `__fixtures__.ts` samples
have never been checked against genuine device SMS.

---

## 6. UPGRADE CANDIDATES

Ordered by value ÷ effort. Every item maps to a numbered gap above.

### A. Commit an executable fixture test — effort: **LOW**, value: **HIGH**
Fixes: the "no test" meta-risk. Add `vitest` (or a plain `node --test` script),
a `parser.test.ts` that runs every `FIXTURES` entry + the Phase-2 constants
through `parseAllMessages` and asserts amount/date/type/code/recipient/count. No
production code changes. This is the precondition for doing anything else safely.

### B. Parse date-only formats — effort: **LOW**, value: **HIGH**
Fixes #3, unblocks #9 partially. In `date.ts`, make the time group optional in
`RE_SLASH` / `RE_DASH_NUMERIC` / `RE_ISO` (default to 12:00), add a
dot-separated pattern (`dd.mm.yyyy`) and a `Mon DD, YYYY` pattern. Add fixtures.
Watch: a date-only ambiguous slash date needs the same both-readings logic as C.

### C. Try both readings before rejecting an ambiguous date — effort: **LOW**, value: **MED**
Fixes #8. In `extractDate`, when the DD/MM reading fails the future/`<2007`
guard, retry as MM/DD; if that is valid and ≤ now, use it (keep
`ambiguous: true`). Purely additive.

### D. Stop merging on synthetic codes — effort: **LOW**, value: **MED-HIGH**
Fixes #5. In `linkTransactions`, skip the grouping/merge path when
`codeResult.synthetic` is true for a group (or require at least one non-synthetic
member). Synthetic codes are collision-prone by construction; they should never
be a merge key. Tiny change, low regression risk (the GlobalPay linking fixture
uses real shared codes, unaffected).

### E. Feed direction confidence into scoring + widen the keyword set — effort: **LOW-MED**, value: **HIGH**
Fixes #1. Two parts:
1. In `finalizeTransaction`, when `direction.confidence <= 30` (the "no keyword,
   guessed" value), push `'direction'` into `missingFields` and cap
   `confidenceLevel` at `medium` (or `low`). Make `confidence.ts` accept and
   weight the sub-confidences instead of only checking field presence.
2. Add received keywords: `credited to your`, `has been received`, `received into`,
   `M-?PESA account has been credited`, `top(?:ped)?[ -]?up`, `disbursed to`,
   `paid into your`, and sent keywords `cash out`, `disbursed`, `loaded to`.

### F. Surface per-transaction quality in the receipt view and the downloaded doc — effort: **MED**, value: **HIGH**
Fixes #6, and turns #1/#2/#7/#9 from silent into user-catchable. Render a small
"check this" marker on rows where `confidenceLevel !== 'high'`, `dateAmbiguous`,
`codeIsSynthetic`, or direction was guessed — in `ChatReceiptVisual` and as a
line in `receiptGenerator`'s row output. Then the `lowconf` notice's promise
("they're marked") becomes true. Requires deciding the visual treatment and the
document copy.

### G. Loan-flow classification — effort: **MED**, value: **HIGH**
Fixes #4. Recognise `KCB M-PESA account has been credited to your M-PESA`,
`M-Shwari loan`, `Fuliza … disbursed`, `Hustler Fund loan`, and repayments
(`sent to KCB M-PESA`, `sent to M-Shwari`, Fuliza auto-repay). Give them a
distinct `subType` (`loan_in` / `loan_repay`) that is excluded from both `trueOutflow`
and `totalReceived` and shown as its own "Loans & repayments" line on the
document. Needs `deriveSubType` cases, `merchantCatalog` entries, and
`computeReceiptData` handling.

### H. Fix recipient over-capture — effort: **LOW-MED**, value: **MED**
Fixes #7 and #3a (KCB, Pochi). In `parties.ts`, add terminators to the recipient
lookaheads: `from your`, `\ba/?c\b`, `account`, `via`, `for your business`,
`Ref\b`, a second phone number; and cap the captured name at ~5 words / 40 chars
before `cleanName`.

### I. Widen `classify.ts` transaction vocab — effort: **LOW**, value: **MED**
Fixes the agent-deposit drop and similar. Add `give`, `top[ -]?up`, `loaded`,
`disbursed`, `cash out`, `withdrawn` to `TRANSACTION_VERB_RE`; add `Shs`, `KSh`,
`/=` handling to `CURRENCY_RE` (and mirror in `amount.ts`). Risk: broadening the
gate lets more borderline notices through to extraction — mitigated by the
`amount && date` hard requirement at Stage 5.

### J. Generalise the small-paired-charge and lone-reversal heuristics — effort: **LOW-MED**, value: **MED**
Fixes #10. Drop the `/GlobalPay|Virtual/` gate in `verificationCharge.ts` and
rely on amount ≤ 5 + opposite direction + same normalised counterparty + short
window. In `reversals.ts` / `parseNotices`, when a transaction has `reversalOf`
set but no matching original in the batch, add a notice: *"This looks like a
refund of an earlier payment (ref …). It's counted as money in — remove it if
that payment isn't in this document."*

### K. Per-bank extractors (Equity first) — effort: **MED-HIGH**, value: **MED (HIGH for affected users)**
Fixes #9 properly. Blocked on getting **real** sample SMS from each bank — the
current work on Airtel/T-Kash was done blind against invented fixtures and those
assumptions (esp. `RE_AIRTEL_ID` date encoding) are unverified. Do B/C/E/H first;
they cover most of what a bank format needs. Then add bank-specific
recipient/date/direction patterns + fixtures per provider as real samples arrive.

### L. Count merged-away blocks honestly — effort: **LOW**, value: **LOW-MED**
In `parseAllMessages`, track `rawResults.length - linked.length` and expose it, so
a merge (legitimate or collision) is at least visible as a number even when the
`linked` notice copy is vague. Complements D.

---

## Summary — the single most dangerous weakness

**The parser cannot tell a guessed direction from a certain one, and when it
guesses it always guesses "sent".** `extractDirection` returns
`{ type: 'sent', confidence: 30 }` for any message lacking an exact
sent/received keyword, and `confidence.ts` never looks at that number — it scores
only whether `type` holds one of two enum values, which is always true. So a
received payment worded in anything other than Safaricom's house style (common
for Equity, KCB, Hustler Fund and banks generally) is silently recorded as money
leaving the wallet, at `high` confidence, with nothing marking it for review. On a
reimbursement claim or an expense summary this is a 200% error in the worst
direction — an inflow booked as an outflow — and every downstream safety net
(`lowconf` marking, per-row confidence display, the ambiguity notice) is either
not wired to the direction guess or not rendered at all.
