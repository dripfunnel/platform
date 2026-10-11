import { defineConfig } from 'vitest/config'

// publish.test.ts and themes.test.ts each take whole sites through a headless browser; sharing the CPU, they time out.
export default defineConfig({ test: { fileParallelism: false } })
