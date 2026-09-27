import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export const storefront = tseslint.config(
  { ignores: ['.next/**', 'out/**', 'node_modules/**', 'next-env.d.ts'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  { languageOptions: { globals: { ...globals.browser } } },
  {
    files: ['src/theme/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-globals': ['error', 'fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource'],
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@dripfunnel/*', '!@dripfunnel/storefront-core'], message: 'Themes use only storefront-core.' }] },
      ],
    },
  },
)
