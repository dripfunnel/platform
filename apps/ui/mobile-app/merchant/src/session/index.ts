import { useSyncExternalStore } from 'react'
import { apiPath, partnerDomain } from '../graphql'
import { type ApiClient, type RestOptions } from '@dripfunnel/mobile-shared/graphql'
import { secureStorage } from './secureStorage'
import { createSessionClient, createSessionStore, type SessionState, type SessionStore } from './sessionStore'

export { createSessionClient, createSessionStore, type Acting, type Notice, type SessionState, type SessionStorage, type SessionStore } from './sessionStore'

// One session and one client per running app, made on first use so the build's host is read when it is needed.
let store: SessionStore | undefined
let client: ApiClient | undefined

export const session = (): SessionStore => (store ??= createSessionStore(secureStorage(partnerDomain())))

/** Every call a signed-in person makes goes through this: it adds the session and ends it on UNAUTHENTICATED. */
export const sessionClient = (): ApiClient => (client ??= createSessionClient(session(), { domain: partnerDomain(), path: apiPath }))

// One AI change is checked and repaired before it answers, which outlasts the 15 s every other call gets (AI-STUDIO.md §4).
const designTimeoutMs = 120_000
let slowClient: ApiClient | undefined
export const designClient = (): ApiClient => (slowClient ??= createSessionClient(session(), { domain: partnerDomain(), path: apiPath, timeoutMs: designTimeoutMs }))

export const restOptions = (): RestOptions => ({ domain: partnerDomain() })

export const useSession = (): SessionState => {
  const current = session()
  return useSyncExternalStore(current.subscribe, current.getState)
}
