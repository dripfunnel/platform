import { tanstackRouter } from '@tanstack/router-plugin/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tanstackRouter({ target: 'react', autoCodeSplitting: true }), react()],
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
