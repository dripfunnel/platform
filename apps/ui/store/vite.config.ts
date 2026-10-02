import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
  // The first render through the router in a file can pass 5 s on a cold runner (#189).
  test: { testTimeout: 20_000 },
  server: {
    proxy: { '/api': 'http://localhost:8787' },
  },
})
