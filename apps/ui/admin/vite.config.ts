import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  // The first render through the router in a file can pass 5 s on a cold runner (#189).
  test: { testTimeout: 20_000 },
  server: {
    // The Worker routes by hostname and checks Origin against it (ARCHITECTURE.md §2,
    // ACCESS.md §4), so dev has to look like production to it rather than like localhost.
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        headers: { host: 'admin.localhost', origin: 'https://admin.localhost' },
      },
    },
  },
})
