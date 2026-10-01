import { defineConfig } from 'vitest/config'

// Integration tests run against a real local Postgres (docs/api/README.md §7), each run in a
// database of its own. They are a separate project from the unit tests so `pnpm test` stays
// fast and needs nothing running, while `pnpm test:integration` needs the database up.
export default defineConfig({
  // Node loads Pothos and Yoga with the production build of graphql; without this, Vite gives
  // our own imports the development one, and graphql refuses types from a second copy.
  ssr: { resolve: { conditions: ['module', 'node'] } },
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./scripts/migrate/vitest-global-setup.ts'],
    // One database per run, shared by the files in it; creating one per file would multiply
    // the migration cost for no isolation the transaction boundary does not already give.
    fileParallelism: false,
    testTimeout: 30_000,
  },
})
