import { useEffect, type ReactNode } from 'react'
import { session, useSession } from './index'

// Startup step 4 (ARCHITECTURE.md §4): read the saved session from secure storage before any screen renders.
export function SessionProvider({ children }: { children: ReactNode }) {
  const state = useSession()
  useEffect(() => {
    void session().restore()
  }, [])
  return state.status === 'starting' ? null : <>{children}</>
}
