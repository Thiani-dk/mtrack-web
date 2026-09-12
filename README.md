# React + TypeScript + Vite

## Tests

```sh
npm test        # unit tests (vitest) — fast, no browser, runs anywhere
npm run test:e2e   # browser checks — needs a dev server and a Chromium (see below)
```

`npm test` is the standard run. It covers the parsing pipeline, document layout
(including a standing text-overlap regression test) and Active Mode's session
logic, all in plain Node.

### Browser checks (`npm run test:e2e`) — manual / CI-optional

`e2e/` drives the real app in a headless browser. It is **not** part of
`npm test`, because it needs two things the unit suite does not:

1. **A running dev server.** Start one first:
   ```sh
   npm run dev                 # then, in another terminal:
   npm run test:e2e
   ```
   It defaults to `http://localhost:5173/`. Vite takes the next free port when
   that one is busy, so if it did, point the checks at the right one:
   ```sh
   E2E_BASE_URL=http://localhost:5174/ npm run test:e2e
   ```

2. **A Chromium binary.** `playwright-core` is a small dev dependency that
   ships no browser, so the checks use whichever Chromium is already on the
   machine — a Playwright-managed one under `~/.cache/ms-playwright`, or an
   installed Chrome. If there is neither, install one with
   `npx playwright install chromium`, or point at an existing binary with
   `CHROME_PATH=/path/to/chrome`.

Both scripts exit non-zero on failure and say exactly what was missing if the
server or the browser is not there.

| Script | What it covers |
| --- | --- |
| `e2e/journey.e2e.mjs` | The full Active Mode journey: HomeScreen → first-run walkthrough with a real practice capture → buckets created on the fly → paste-and-file in two actions → auto-file to Unsorted → duplicate warning → mid-paste reload → Finish, with the on-screen figures checked against the document actually written to IndexedDB. |
| `e2e/buckets.e2e.mjs` | Long-press to rename or delete an Active Mode bucket: that holding a chip opens the menu without also firing the tap that files a sale, that Unsorted has no such menu, and that deleting a bucket with sales in it moves them to Unsorted rather than taking them with it. |
| `e2e/capture.e2e.mjs` | Two conversational-capture transcripts from real device testing, replayed through the actual chat: a point-of-sale message containing two priced items (it must not go on to ask what was bought), and a rejected date followed by a fresh ambiguous one (it must be disambiguated, not discarded), plus the retry cap still catching a genuine loop. |
| `e2e/wakeLock.e2e.mjs` | Screen Wake Lock wiring against a stubbed `navigator.wakeLock` that behaves as the spec says a real one does: taken on arrival, re-taken silently after backgrounding, given back on leaving, and absent entirely (indicator and all) where the API is not there. |
| `e2e/paste.e2e.mjs` | The one-tap Paste button in both places it appears, against a stubbed clipboard: that it feeds the same capture path a manual paste does, that a refused clipboard shows one quiet line without blocking the manual fallback, and that it is absent where clipboard reading is unavailable. |
| `e2e/onboarding.e2e.mjs` | That onboarding never describes a capability the device lacks — the walkthrough run with both APIs, neither, and one — plus the composer's Paste tip showing once and never returning. |
| `e2e/viewport.e2e.mjs` | Layout at the constrained sizes Active Mode has to survive — 360×400, 640×280 and 360×210 (split screen with the keyboard open) — asserting the paste field, chip row, running total and Finish are all on screen, the `dvh` container tracks the viewport, and the chip row scrolls sideways with its last chip fully reachable. |

These exist because they catch a class of bug the unit suite structurally
cannot: wiring. Focus behaviour, persistence timing, app routing after a
backgrounded reload, and whether what a vendor sees matches what was saved.
Two real bugs found this way — landing on HomeScreen instead of Active Mode
after a reload, and the constrained-viewport layout — were invisible to
`npm test`.

Screenshots land in `e2e/screenshots/` (gitignored).

---


This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])

```
