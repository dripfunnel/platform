import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { PortalStaffSession } from './staffSession'
import { createPortalSessionFixture, type PortalHarnessState, type PortalSessionFixtureOptions } from './staffSessionFixture'

export interface PortalSessionOptions extends PortalSessionFixtureOptions {
  // The ?state= harness: only then does the fixture answer.
  harnessEnabled: boolean
}

const notConnected = () => Promise.reject(new Error('The portal APIs have no staff-session operations yet (#40).'))

// Seam: the portal's half of #40 (the handoff exchange, the current session and the member
// notice) answers from a fixture until #68 wires it (https://github.com/dripfunnel/platform/issues/40).
export const createPortalSession = ({ harnessEnabled, ...fixtureOptions }: PortalSessionOptions) => {
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
    exchange: (token: string): Promise<PortalStaffSession | null> => {
      if (!harnessEnabled) return notConnected()
      const session = fixture.enter(token)
      changed()
      return Promise.resolve(session)
    },
    current: (): Promise<PortalStaffSession | null> => Promise.resolve(harnessEnabled ? fixture.current() : null),
    notice: (): Promise<PortalStaffSession | null> => Promise.resolve(harnessEnabled ? fixture.notice() : null),
    end: (id: string): Promise<void> => {
      if (!harnessEnabled) return notConnected()
      fixture.end(id)
      return Promise.resolve()
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
