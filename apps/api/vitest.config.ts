import { defineConfig } from 'vitest/config'

export default defineConfig({
  // Node loads Pothos and Yoga with the production build of graphql; without this, Vite gives
  // our own imports the development one, and graphql refuses types from a second copy.
  ssr: { resolve: { conditions: ['module', 'node'] } },
  test: {
    // tests/ is the integration suite, which creates a database of its own per run and has
    // its own config. Excluded here so `pnpm test` does not run it twice.
    exclude: ['node_modules/**', 'dist/**', 'tests/**'],
    // Every DB-backed test file connects to DATABASE_URL directly; this guards the host once
    // for the whole run instead of relying on individual test files to call assertLocalHost.
    globalSetup: ['./scripts/migrate/vitest-global-setup.ts'],
  },
})
