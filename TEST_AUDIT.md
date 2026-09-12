# Test audit — vacuous assertions

**Date:** 12 September 2026
**Scope:** the entire test suite, read-only. No code or test was changed.

---

## 1. Methodology

Every assertion was put to one question: **if the code under test were replaced with a no-op — return null, skip the state update, drop the field — would this specific assertion fail?** Where the answer was "no", the assertion is recorded as vacuous. Where it was "not obviously", it is recorded with the uncertainty stated rather than resolved by guessing.

**Reviewed:**

| | Files | Assertions |
|---|---|---|
| Unit tests (`src/**/*.test.ts`) | 10 | 388 `expect()` calls across 171 `it()` blocks |
| E2E scripts (`e2e/*.e2e.mjs`) | 7 | 118 `check()` call sites, 120 executed (three run in a loop) |
| Shared harness (`e2e/harness.mjs`) | 1 | the `reporter()`/`check()` collector plus 4 fixture/navigation helpers |
| Test-local helpers | — | `describe1`/`answer` (slots), `expectClean`/`collisions`/`drawnText` (overlap), `fakeEnv`/`fakeSentinel` (wakeLock), `menuPanel`/`longPress`/`tallyOf` (buckets), `lastBotLine`/`transcript` (capture) |

Three passes were made rather than one:

1. **Mechanical sweep** for the named patterns — grep for existence-only matchers (`toBeDefined`, `not.toBeNull`, `not.toThrow`, `toBeTruthy`), for optional chaining paired with absence matchers, for expectations whose both sides derive from the same value, and for un-awaited async inside `check()` (a `Promise` object is truthy, so a missing `await` would report PASS unconditionally — **none found**; the only `check()` calls without `await` are the `pageerror` handlers, which pass a literal `false`).
2. **Read-through** of every file, tracing each assertion back to the production code path it claims to cover.
3. **Empirical confirmation** for the one finding that could not be settled by reading. Two checks depend on whether a CSS `display:none` media query hides an element at the viewport the test happens to use. Rather than guess, I ran a read-only probe against the live app at three viewports (below). That probe changed the verdict on three separate findings — two downgraded, one confirmed — which is the main reason I would not trust a reading-only version of this report.

**A note on what "sound" means here.** Several checks are sound only because a *neighbouring* assertion in the same file covers the gap. Those are recorded as sound-in-context with the dependency named, because deleting or reordering the neighbour would silently make them vacuous.

---

## 2. Confirmed vacuous or weak assertions

### 2.1 `journey.e2e.mjs` — the bucket-total checks are pure test arithmetic

**File:** `e2e/journey.e2e.mjs:190–191`
**Test:** "Finish and check the report"

```js
check('bucket subtotals sum to the document total',
  Math.abs(Object.values(doc.buckets).reduce((s, b) => s + b.total, 0) - doc.total) < 0.005);
check('bucket counts sum to the itemisation length',
  Object.values(doc.buckets).reduce((s, b) => s + b.count, 0) === doc.n);
```

Both sides of both comparisons are computed **by the test**, from the same array, twenty lines earlier:

```js
for (const t of d.transactions) { buckets[k].count++; buckets[k].total += t.amount; }
return { n: d.transactions.length, total: d.transactions.reduce((s, t) => s + t.amount, 0), buckets, ... };
```

Summing per-group sums of an array always equals summing the array. Summing per-group counts always equals its length. These two assertions are arithmetic identities over test-local variables — they cannot fail for any behaviour of the application, correct or not. `buildDocModel`, `buildBuckets` and the bucket-rendering code are never consulted.

**What could ship past them:** the entire bucket-breakdown section could be wrong — a bucket's subtotal double-counting, a bucket omitted from the section, `bucketLabel` dropped on save so every sale collapses into Unsorted — and both checks still report green. They are named as if they are the money-correctness checks on the end-of-day report, which is what makes them worth flagging first.

**What has no protection here:** the bucket breakdown rendered on the finished document, at the e2e level. (It *is* genuinely covered at unit level — see §4.1 — so the real gap is narrower than the check names suggest: nothing verifies that the figures which reach IndexedDB and the renderer agree with the ones the vendor saw on screen.)

---

### 2.2 `paste.e2e.mjs` — an empty-state match standing in for "the manual paste worked"

**File:** `e2e/paste.e2e.mjs:115–117`
**Test:** Active Mode, clipboard-read unsupported

```js
check('and manual pasting works exactly as before',
    (await page.locator('.am-capture').innerText()).toLowerCase().includes('tap a bucket'));
```

The `.am-capture` region renders one of two things. With a capture pending: `Tap a bucket to file it`. With nothing pending: `Paste a payment message. It files on paste — then tap a bucket.` Lowercased, **both contain `tap a bucket`**.

This block runs at a 390×844 viewport. I verified against the live app that at that height the empty-state hint is visible and `.am-capture` innerText is:

```
"paste a payment message. it files on paste — then tap a bucket."   includes("tap a bucket") → true
```

with nothing pending at all. The assertion therefore passes unconditionally.

**What could ship past it:** the manual paste path could be entirely broken on browsers without clipboard-read support — the `onPaste` handler not firing, `capture()` returning null, the pending card never rendering — and this check still reports green. This is the same shape as the two historical bugs.

**What has no protection here:** that the long-press-and-paste fallback still works when the Paste button is absent, which is the entire claim of that test block.

---

### 2.3 `buckets.e2e.mjs` — a dead conjunct that hides one specific failure mode

**File:** `e2e/buckets.e2e.mjs:103–106`
**Test:** "holding a chip does not also file the pending sale"

```js
check('holding a chip does not also file the pending sale',
    (await page.locator('.am-total').innerText()).trim() === totalBeforeHold
    && (await page.locator('.am-capture').innerText()).toLowerCase().includes('tap a bucket'),
    totalBeforeHold);
```

Same viewport (390×844), same empty-state collision as §2.2 — the second conjunct is true whether or not a capture is pending.

This check is **not** fully vacuous: the first conjunct (day total unchanged) does catch the specific bug it was written for, a long press also firing the click that files the sale. But the second conjunct contributes nothing, and it was clearly intended to assert "the capture is *still pending*".

**What could ship past it:** a long press that **discards** the pending capture without filing it. The total would be unchanged (first conjunct passes) and the empty-state hint would render (second conjunct passes) — a sale silently destroyed by a gesture, reported green. Given this project's standing rule that a captured sale is never lost, that is a meaningful hole.

---

### 2.4 `journey.e2e.mjs` — two checks that are sound only by accident of a media query

**File:** `e2e/journey.e2e.mjs:78` and `:140`

```js
check('paste alone produces a pending capture (action 1)',
  (await page.locator('.am-capture').innerText()).toLowerCase().includes('tap a bucket'));
check('a capture is pending before the reload',
  (await page.locator('.am-capture').innerText()).toLowerCase().includes('tap a bucket'));
```

Textually identical to §2.2 and §2.3. But this script runs at **360×400**, and `src/index.css` carries:

```css
@media (max-height: 460px) { .active-mode .am-hint { display: none; } }
```

I confirmed empirically that at 360×400 and 360×210 the empty-state `.am-capture` innerText is `""` and the match is `false`, while at 390×844 it is `true`. So at this script's viewport **these two assertions currently do distinguish** a pending capture from an empty one, and are not vacuous today.

They are listed here because their soundness has nothing to do with their intent. It rests on a cosmetic responsive rule about hiding an instructional line on short screens. Raising that breakpoint, deciding the hint should always show, or changing this script's viewport to a taller one — any of which is a reasonable change nobody would think to connect to a test — silently converts both into §2.2. `journey.e2e.mjs:78` is the *only* check in the suite covering the headline "two actions per sale" claim at the e2e level, so it is a load-bearing assertion resting on an incidental detail.

**Stated uncertainty:** I am confident about the current behaviour (measured, not reasoned). I am flagging fragility, not a present failure.

---

### 2.5 `capture.e2e.mjs` — five absence-only assertions

**File:** `e2e/capture.e2e.mjs:55, 59, 87, 95, 112`

```js
check('it does NOT ask how much — it was told twice', !/How much was it\?/.test(afterItems));
check('it does NOT go on to ask what they bought', !/What did they buy\?/.test(afterDate), ...);
check('the date is not abandoned', !/leave the date off/.test(await transcript()));
check('one unreadable answer asks again', !/leave the date off/.test(await transcript()));
```

Each asserts only that a string is **absent** from the page. A chat that crashed on mount, rendered nothing, or never advanced past the greeting satisfies every one of them.

In context they are guarded: the same script asserts positively that the confirmation sentence reads `Call time $500, Sms time $250 — total $750` (line 63) and that the disambiguation question appears (line 86). So the file as a whole is not blind. But each of these five individually is a "nothing visibly broke" check, and `:112` in particular ("one unreadable answer asks again") never verifies that the bot *did* ask again — only that it did not give up.

**What could ship past them individually:** any failure that stops the conversation producing output at all.

---

### 2.6 `buckets.e2e.mjs` — a matcher loose enough to accept a half-broken fixture

**File:** `e2e/buckets.e2e.mjs:62–63`

```js
const comboBefore = await tallyOf('Combo sales');
check('two sales filed into Combo sales', /1,050|350/.test(comboBefore), comboBefore);
```

Two sales of 350 and 700 have just been filed; the correct tally is `Ksh 1,050.00 · 2`. The alternation accepts `350` on its own, so the check passes if **only the first sale was filed** and the second was dropped — despite being named "two sales".

It compounds: `comboBefore` is the baseline for the later rename check (`:95`, "rename preserves the subtotal and count"), which compares before against after. A wrong-but-accepted baseline makes that comparison verify that a wrong figure was preserved unchanged.

**What could ship past it:** a second consecutive file-into-the-same-bucket silently failing. A precise equality against `Ksh 1,050.00 · 2` was available and would have been honest.

---

### 2.7 `wakeLock.test.ts` — `resolves.toBeUndefined()` on a `Promise<void>`

**File:** `src/lib/wakeLock.test.ts:177–178, 188`

```js
await expect(lock.acquire()).resolves.toBeUndefined();
await expect(lock.release()).resolves.toBeUndefined();
```

`acquire()` and `release()` are declared `Promise<void>`. They resolve to `undefined` on every path by construction, so these assert nothing about behaviour — they are "it did not throw" wearing the costume of a value check.

Both tests bracket them with real state assertions (`expect(lock.state()).toBe('unsupported')` before and after), so the tests are not vacuous; these particular lines are decorative. Low risk, listed for completeness.

---

### 2.8 `direction.test.ts` — `not.toBe('unknown')` where the correct value was knowable

**File:** `src/lib/activeMode/direction.test.ts:76–80`
**Test:** "re-derives the subType and sender to match money coming in"

```js
expect(t.sender).not.toBeNull();
expect(t.subType).not.toBe('unknown');
```

`sender` genuinely discriminates — a no-op `applyActiveModeDirection` leaves `sender` null for this fixture, so that line fails correctly. `subType` does not: the assertion accepts **any** of the ten `TransactionSubType` values except `'unknown'`. A re-derivation that produced `person_send` — the exact opposite of "money coming in", which is what the test name claims — passes.

**What could ship past it:** a subType derived with the wrong direction, which downstream affects how a line is categorised and described on an exported document.

---

### 2.9 `walkthrough.test.ts` — an empty-state expectation as the only outcome

**File:** `src/lib/activeMode/walkthrough.test.ts`, "reads the real APIs when asked about this device"

```js
const caps = detectCapabilities();
expect(typeof caps.wakeLock).toBe('boolean');
expect(capabilityLines(caps)).toEqual([]);
```

Under Node neither API exists, so the expected result is the empty array — which is also what a `capabilityLines` that ignored its argument and always returned `[]` would produce, and what a `detectCapabilities` hard-coded to `false` would produce. `typeof x === 'boolean'` accepts a constant.

Guarded by the sibling tests in the same block, which pass explicit capability objects and assert the exact lines. Listed because, read alone, it is a pure empty-state match (pattern 2). Low risk.

---

## 3. Broken or weak shared helpers

### 3.1 `conversationalCapture.slots.test.ts` — the test re-implements the code it is testing, and re-implemented it *correctly* while production was wrong

**This is the most consequential finding in the audit, and it is the direct explanation for the `absorbAnswer` bug surviving green.**

`describe1()` and `answer()` (`:47–84`) are not thin wrappers around production code. They are a **parallel model** of `ChatScreen`'s `handleDescription` and its `field-date` / `field-amount` / `field-recipient` handlers, written by hand in the test file. The library functions they call (`extractDescription`, `openSlots`, `absorbAnswer`, `parseAmountReply`, `parseConversationalDate`) are real. The **wiring between them is not** — and the wiring is where both of this project's historical bugs lived.

The test helper composes the date answer like this:

```js
draft: { ...draft, ...absorbAnswer(draft, text), date: d.date ?? draft.date },
```

Production, at the same moment in time, composed it like this (`git show 918e8596^:src/components/chat/ChatScreen.tsx`, lines 1250–1255):

```js
...flow.draft, date: d.date, dateAmbiguous: false,
dateInterpretation: d.interpretation, dateSkipped: false,
...absorbAnswer(flow.draft, t),      // ← spread LAST: clobbers the date just set
```

The helper spreads `absorbAnswer` **first**; production spread it **last**. Because `absorbAnswer` returned a spread of its whole input — including the stale `date: null` — production discarded every accepted date, and the walkthrough re-asked "when was that?" after every valid answer.

Both were written in the same commit (`182f26ec`), and `git log -L61,72` confirms the helper has **never been edited since**. It modelled the correct ordering from the day it was written. It was structurally incapable of reproducing the bug it was ostensibly guarding.

**Blast radius:** every test in the file that routes through these two helpers — the Sambonani point-of-sale fixture, the RAM/CPU hardware fixture, "does not go on to ask what they bought", "answering settles the date", the absorb-more-than-was-asked tests. **Roughly 30 tests, 56 assertions** — the entire slot-filling suite.

**What these tests do protect:** the extractors. `extractLineItems`, `openSlots`, currency locking and amount parsing are genuinely exercised and genuinely covered.

**What they do not protect, despite their names:** that `ChatScreen` composes drafts in an order that preserves what it just set; that the pending-prompt handlers call the right functions with the right arguments; that a field written by one handler survives the next. Every test named after a conversational outcome ("does not go on to ask…", "settles the date and moves on") is asserting about the test's own model of the conversation, not the application's.

The only real coverage of that wiring is `e2e/capture.e2e.mjs`, added much later and covering two transcripts.

---

### 3.2 `capture.e2e.mjs` — `lastBotLine()` selects by a selector that is not "the last bot line"

**File:** `e2e/capture.e2e.mjs:22–25`

```js
const lastBotLine = async () => {
    const lines = await page.locator('[data-role="bot"], .whitespace-pre-wrap, p').allInnerTexts();
    return lines.filter(Boolean).map(l => l.trim()).filter(Boolean).pop() ?? '';
};
```

It collects **every `<p>` on the page** plus anything with `.whitespace-pre-wrap`, and takes the last in DOM order. Nothing constrains the result to a bot message, or to the most recent one. Any `<p>` rendered below the message list wins — and one exists: `PasteButton`'s failure note is `<p role="status">`, rendered inside the composer, beneath the transcript.

I observed this helper returning the wrong element during development (it returned the date prompt when the actual last bot line was a confirmation), which is what makes this a measured fragility rather than a theoretical one. I have **not** confirmed a case where it currently returns the wrong element in a passing run — stated explicitly so this is not over-claimed.

**Blast radius:** 6 of the 16 checks in the file, including `:102` ("the confirmation carries 4 May 2026"), which is the single closest thing the suite has to a direct regression guard on the `absorbAnswer` date-discarding bug. If the helper silently returns a different `<p>`, that check reports on the wrong string in either direction.

**Related, same file:** both `lastBotLine()` and `transcript()` are proxies by nature — they read the rendered conversation, never the draft state or the stored document. The suite has no assertion anywhere that a date accepted in chat is actually *stored* on the resulting transaction. `journey.e2e.mjs` is the only script that opens IndexedDB and reads real records back, and it does so only for Active Mode.

---

### 3.3 `harness.mjs` — `check()` accepts any truthy value as a pass

**File:** `e2e/harness.mjs:81–84`

```js
check(name, pass, detail = '') {
    results.push({ name, pass, detail });
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${...}`);
}
```

`pass` is never validated as a boolean. A forgotten `await` inside a `check()` argument yields a `Promise`, which is truthy, and the check reports PASS forever.

**I swept all 118 call sites and found no instance of this** — every `check()` containing a `page.` call awaits it. So this is a latent hazard rather than a present defect. It is listed under shared helpers because its blast radius, if it ever occurred, is one silently-green check per mistake, with no signal that anything is wrong; a `typeof pass !== 'boolean'` guard would make the class impossible.

---

### 3.4 `documentLayout.overlap.test.ts` — `expectClean()` passes on empty input

**File:** `src/lib/documentLayout.overlap.test.ts`

```js
function expectClean(m: DocModel): DrawnString[] {
    const drawn = draw(m);
    expect(collisions(drawn), 'overlapping text').toEqual([]);
    expect(overflows(drawn), 'text outside the page margins').toEqual([]);
    return drawn;
}
```

If `measureDrawnStrings` returned `[]` — a PDF layout that drew nothing at all — `collisions([])` and `overflows([])` are both `[]` and the helper passes. It is an absence-of-badness check with no presence-of-goodness counterpart.

**I checked all 7 call sites and every one follows `expectClean` with a content assertion** (`expectDrawn`, an exact `toEqual` on drawn rows, or `rowBaselines`). So no test currently relies on it alone, and the suite is sound.

It is listed because the protection lives in call-site discipline rather than in the helper. A future test that calls `expectClean` and nothing else would be fully vacuous while looking identical to the seven that are fine — and "the PDF drew nothing" is precisely the kind of failure this file exists to catch.

---

## 4. Tests checked and found genuinely sound

A representative sample that passed the no-op test cleanly, for calibration:

**4.1 `report.test.ts` — "sums to the hero total and to the itemisation"** is the correct version of what `journey.e2e.mjs:190` attempts. The bucket total comes from `model.buckets` (the application's `buildDocModel` output, parsed back out of its rendered strings); it is compared against `computeReceiptData(DAY).totalTransactionAmount` — an **independent** production code path — *and* against a hardcoded `1840`. Two anchors, neither computed by the arithmetic under test. A bucket dropped, double-counted or mislabelled fails it.

**4.2 `journey.e2e.mjs:187–189` — the IndexedDB cross-check.** Reads the saved document out of the real database and compares its transaction count and summed total against the strings that were on screen before Finish was tapped. Two genuinely independent sources. This is the strongest assertion in the e2e suite and the model the rest should follow.

**4.3 `wakeLock.test.ts` — "re-takes the lock the browser took away".** Asserts `requestCount() === 2` and `state() === 'held'` after a full background/foreground cycle against a fake that models the spec's release-on-background behaviour. A no-op visibility handler fails on the count; a handler that re-requests but mismanages state fails on the state. The corresponding e2e counts **live sentinels** rather than call counts, specifically because a browser-initiated release does not go through `release()` — that distinction was found by the test failing for the right reason during development.

**4.4 `session.test.ts` — "never destroys a sale — it moves them to Unsorted".** Asserts the exact post-delete bucket membership, the unchanged day total, and the unchanged transaction count. Each of the three fails independently for a different real bug (sale destroyed, sale duplicated, sale mislabelled). Its sibling e2e check reads the labels back out of IndexedDB as `[null, null]` rather than inferring from the chip row.

**4.5 `dateRetry.test.ts` — the transcript replay.** Asserts the *exact* disambiguation string (`'Is that 4 May 2026 or 5 April 2026?'`) and the exact attempt counter after each turn. A cap that gave up early, a parser that rejected the second date, or a counter that failed to reset each fails a distinct assertion.

**4.6 `conversationalCapture.currency.test.ts` — "the confirmation sentence".** Uses full-string `toBe` on the complete rendered sentence rather than substring matching, so wording, currency symbol, amount and assumption-note are all pinned at once. Note the contrast with §3.1: this file tests a **pure function** that production genuinely calls, which is why it is sound where the slots file is not.

**4.7 `viewport.e2e.mjs`** — every check is a numeric geometry comparison against the actual viewport, with `null`-propagating helpers that fail rather than throw when an element is missing. `inside(box(null))` is `false`, so a missing paste field fails the check instead of crashing the script.

---

## 5. Findings ranked by risk

Ranked by what it costs if the bug each fails to catch actually ships, using this project's established framing: **money on a document someone acts on** outranks everything else.

| # | Finding | Risk | Why |
|---|---|---|---|
| **1** | §3.1 — slot-filling suite re-implements the flow it tests | **Highest** | 30 tests, 56 assertions, over the conversational capture that produces reimbursement claims and receipts. Already demonstrably allowed one shipping bug (every accepted date silently discarded). The wrong figure or wrong date on a claim someone submits is the most expensive failure this app has. |
| **2** | §2.1 — bucket totals are test arithmetic | **High** | Named as the money-correctness check on the end-of-day report; protects nothing. A vendor's day's takings misattributed or mis-totalled on a document they hand over or file. Mitigated only by §4.1 covering the same ground at unit level. |
| **3** | §3.2 — `lastBotLine()` selects unreliably | **High** | Compromises the only direct regression guard on the date-discarding bug, and 5 other checks on the conversational path. Wrong dates and wrong items on exported documents. |
| **4** | §2.3 — dead conjunct hides a discarded capture | **Medium-high** | A sale silently destroyed by a gesture — directly contradicts the standing "never lose a sale" rule, and money vanishing is worse than money misfiled. Partially mitigated by the total-unchanged conjunct. |
| **5** | §2.6 — `/1,050\|350/` accepts a half-broken fixture | **Medium** | A dropped sale passing as filed, plus a corrupted baseline propagating into the rename check. Money, but caught downstream by the IndexedDB assertions in the same file. |
| **6** | §2.2 — empty-state match for the manual paste fallback | **Medium** | No money is wrong; capture simply stops working on unsupporting browsers with no test signal. Costs the feature, not the figures. |
| **7** | §2.4 — two journey checks sound only by media query | **Medium (latent)** | Currently correct. Would become §2.2 — including the only e2e coverage of the two-actions-per-sale claim — on an unrelated cosmetic change. |
| **8** | §2.8 — `not.toBe('unknown')` on subType | **Low-medium** | A wrong direction reaching a document's categorisation, but the sibling `sender` assertion catches the most likely no-op. |
| **9** | §2.5 — five absence-only checks in `capture.e2e.mjs` | **Low** | Guarded by positive assertions in the same file; only a total rendering failure slips through, which other checks catch loudly. |
| **10** | §3.4 — `expectClean()` vacuous on empty | **Low (latent)** | All 7 current call sites guarded. A trap for the next test author, in a file whose whole purpose is catching a PDF that renders wrongly. |
| **11** | §3.3 — `check()` accepts truthy | **Low (latent)** | No present instance across 118 call sites; one forgotten `await` away from a permanently-green check. |
| **12** | §2.7 / §2.9 — decorative matchers | **Lowest** | Both bracketed by real assertions. Cosmetic honesty, no coverage gap. |

---

## 6. Suggested next step

Fix the shared helpers before anything else, because they set the ceiling on how much the rest is worth: §3.1 first — until the slot-filling tests exercise the real `ChatScreen` composition rather than a hand-written model of it, the 30 tests sitting on top of it are asserting about the test file, and any repair to the individual assertions underneath would be repairing something that was never connected to production. The cheapest honest version is probably to extract the draft-composition logic out of the component into a pure reducer that both the handlers and the tests call, so there is exactly one implementation of "fold this answer into the draft" — the same de-duplication move already applied to `openSlots` and `buildConfirmSentence`. Then §3.2, since a helper that selects the wrong element makes its six checks unreadable in both directions. After that work down the risk table, taking §2.1 next: it is a small, self-contained fix (compare the application's `buildDocModel` buckets against the on-screen chip tallies, the way `journey.e2e.mjs:189` already compares totals) and it restores the money-correctness claim the check's name is making. The latent items (§2.4, §3.3, §3.4) are worth doing last but not skipping — each is a one-line guard that makes a whole class of future mistake impossible rather than merely absent today.
