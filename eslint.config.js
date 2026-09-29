import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

const apiLayers = [
  ['core', []],
  ['db', ['core']],
  ['auth', ['core', 'db']],
  ['engine', ['core', 'db', 'auth']],
  ['integrations', ['core', 'db', 'auth', 'engine']],
  ['saas', ['core', 'db', 'auth', 'engine', 'integrations']],
]
const allApiFolders = ['core', 'db', 'auth', 'engine', 'integrations', 'saas', 'apis', 'hooks', 'jobs']

const forbidFolders = (folders) => ({
  regex: `^(#(${folders.join('|')})(/|$)|(\\.\\./)+(${folders.join('|')})(/|$))`,
  message: 'Layer rule: import only from your own layer or lower (docs/api/README.md §4).',
})

const uiApps = ['admin', 'platform', 'store']

// apps/api is at least three levels up from any file in an app's src/; the app's own src/api/
// (docs/ui/README.md §2) is at most two, so it stays importable.
const noApiImports = {
  regex: '^(@dripfunnel/api|(\\.\\./)+apps/api|(\\.\\./){3,}api)(/|$)',
  message: 'Clients know the API only through apps/api/schema/*.graphql.',
}

export default tseslint.config(
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/out/**', '**/.next/**', '**/.wrangler/**', '**/.turbo/**', '**/*.gen.ts', '**/next-env.d.ts', 'templates/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.es2023 } },
    rules: {
      'no-restricted-syntax': ['error', { selector: 'ExportDefaultDeclaration', message: 'Use named exports.' }],
    },
  },
  {
    files: ['**/*.config.{js,ts,mjs}', 'apps/api/src/index.ts'],
    rules: { 'no-restricted-syntax': 'off' },
  },
  {
    files: ['**/*.config.{js,ts,mjs}', 'scripts/**', 'apps/api/scripts/**'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    languageOptions: { globals: { ...globals.serviceworker } },
    rules: {
      'no-restricted-globals': ['error', { name: 'process', message: 'Bindings arrive through env; never read process.env.' }],
    },
  },
  ...apiLayers.map(([layer, allowed]) => ({
    files: [`apps/api/src/${layer}/**/*.ts`],
    rules: {
      'no-restricted-imports': ['error', { patterns: [forbidFolders(allApiFolders.filter((f) => f !== layer && !allowed.includes(f)))] }],
    },
  })),
  {
    files: uiApps.map((app) => `apps/ui/${app}/**/*.{ts,tsx}`),
    languageOptions: { globals: { ...globals.browser } },
    rules: { 'no-restricted-imports': ['error', { patterns: [noApiImports] }] },
  },
  {
    files: ['apps/ui/shared/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['**/apps/**', ...['api', ...uiApps].flatMap((app) => [`@dripfunnel/${app}`, `**/${app}`, `**/${app}/**`])], message: 'shared/ never imports from the apps.' }] }],
    },
  },
  {
    files: ['packages/storefront-core/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser } },
    rules: {
      'no-restricted-imports': ['error', { patterns: [{ group: ['@dripfunnel/*', '!@dripfunnel/storefront-core', '**/apps/**', '**/shared/**'], message: 'storefront-core is published and imports nothing else from this repo.' }] }],
    },
  },
)
