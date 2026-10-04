import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PortalStaffSession } from './staffSession'
import { createPortalSessionFixture, isFixtureHandoff, type PortalHarnessState, type PortalSessionFixtureOptions } from './staffSessionFixture'

// The portal's own API for its staff sessions (ACCESS.md §8.3): the partner console's is #243;
// the store portal has none until the Store API.
export interface PortalSessionApi {
  exchange: (token: string) => Promise<PortalStaffSession | null>
  current: () => Promise<PortalStaffSession | null>
  notice: () => Promise<PortalStaffSession | null>
  end: (id: string) => Promise<void>
}

export interface PortalSessionOptions extends PortalSessionFixtureOptions {
  // The ?state= harness: only then does the fixture answer.
  harnessEnabled: boolean
  api?: PortalSessionApi
}

const notConnected = () => Promise.reject(new Error('This portal has no staff-session API yet.'))

// The harness's fixture answers a ?state= render and its own sample links; the API everything else.
export const createPortalSession = ({ harnessEnabled, api, ...fixtureOptions }: PortalSessionOptions) => {
  const fixture = createPortalSessionFixture(fixtureOptions)
  const listeners = new Set<() => void>()
  let version = 0
  const changed = () => {
    version += 1
    for (const listener of listeners) listener()
  }
  const subscribe = (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  }

  return {
    exchange: async (token: string): Promise<PortalStaffSession | null> => {
      const session = harnessEnabled && isFixtureHandoff(token) ? fixture.enter(token) : api ? await api.exchange(token) : await notConnected()
      changed()
      return session
    },
    current: async (): Promise<PortalStaffSession | null> => (harnessEnabled ? fixture.current() : null) ?? (api ? api.current() : null),
    notice: async (): Promise<PortalStaffSession | null> => (harnessEnabled ? fixture.notice() : null) ?? (api ? api.notice() : null),
    end: async (id: string): Promise<void> => {
      if (harnessEnabled && fixture.current()?.id === id) return fixture.end(id)
      return api ? api.end(id) : notConnected()
    },
    harness: (state: PortalHarnessState) => {
      if (!harnessEnabled) return
      fixture.harness(state)
      changed()
    },
    // Bumped when this tab enters a session, so the banner shows without waiting for a poll.
    useVersion: () => useSyncExternalStore(subscribe, () => version, () => version),
  }
}

export type PortalSession = ReturnType<typeof createPortalSession>

export type HandoffResult = 'pending' | 'entered' | 'invalid'

// Exchanges the link's one-time token once, even under StrictMode's second effect, then calls
// `clearUrl` so the token never stays in the address bar or the history.
export const useHandoff = (token: string | undefined, exchange: PortalSession['exchange'], clearUrl: () => void): HandoffResult => {
  const [result, setResult] = useState<HandoffResult>(token ? 'pending' : 'invalid')
  const tried = useRef(false)
  useEffect(() => {
    if (tried.current) return
    tried.current = true
    clearUrl()
    if (!token) return
    exchange(token)
      .then((session) => setResult(session ? 'entered' : 'invalid'))
      .catch(() => setResult('invalid'))
  }, [token, exchange, clearUrl])
  return result
}
