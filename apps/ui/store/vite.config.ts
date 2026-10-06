import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  // The first render through the router in a file can pass 5 s on a cold runner (#189).
  test: { testTimeout: 20_000 },
  server: {
    // Each partner's portal is its own host (docs/setup/local.md §7.3): Caddy sends https://store.<partner>.localhost here
    // and its host and origin go on to the Worker unchanged, which finds the partner by them (ARCHITECTURE.md §2).
    proxy: { '/api': { target: 'http://localhost:8787', changeOrigin: false } },
  },
})
