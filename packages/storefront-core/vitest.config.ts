import { defineConfig } from 'vitest/config'

// CI runs every workspace's tests at once, and render tests there can pass the 5 s default (#1152, as the SPAs found on #189).
export default defineConfig({ test: { testTimeout: 20_000, setupFiles: ['./test/setup.ts'] } })
