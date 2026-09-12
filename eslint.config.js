import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'e2e/screenshots']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    // The browser checks (npm run test:e2e). Plain Node scripts, outside src
    // and outside tsc's reach, so this is the only thing checking them.
    //
    // Both global sets, because these files genuinely contain both: the script
    // itself runs in Node, while the callbacks passed to page.evaluate() are
    // serialised and run inside the page, where document, DataTransfer and
    // indexedDB are exactly right.
    files: ['e2e/**/*.mjs'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
  },
])
