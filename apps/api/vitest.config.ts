import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Every DB-backed test file connects to DATABASE_URL directly; this guards the host once
    // for the whole run instead of relying on individual test files to call assertLocalHost.
    globalSetup: ['./scripts/migrate/vitest-global-setup.ts'],
  },
})
