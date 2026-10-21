import '@dripfunnel/shared/ui/fonts.css'
import '@dripfunnel/shared/ui/tokens.css'
import { createRouter, RouterProvider } from '@tanstack/react-router'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { routeTree } from './routeTree.gen'

const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
  // The person a timeline follows, by name: chosen on the Activity log, never typed into the URL (§13).
  interface HistoryState {
    personName?: string
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
