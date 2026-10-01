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
  // A confirmation to show on the screen a change lands on, when the change removed the
  // screen it was made from (Undo and clean up returns to Stores).
  interface HistoryState {
    toast?: string
  }
}

const root = document.getElementById('root')
if (!root) throw new Error('Missing #root element')

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
)
