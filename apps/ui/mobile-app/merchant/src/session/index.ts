import { useSyncExternalStore } from 'react'
import { partnerDomain, type ApiClient, type RestOptions } from '../graphql'
import { secureStorage } from './secureStorage'
import { createSessionClient, createSessionStore, type SessionState, type SessionStore } from './sessionStore'

export { createSessionClient, createSessionStore, type Acting, type Notice, type SessionState, type SessionStorage, type SessionStore } from './sessionStore'

// One session and one client per running app, made on first use so the build's host is read when it is needed.
let store: SessionStore | undefined
let client: ApiClient | undefined

export const session = (): SessionStore => (store ??= createSessionStore(secureStorage(partnerDomain())))

/** Every call a signed-in person makes goes through this: it adds the session and ends it on UNAUTHENTICATED. */
export const sessionClient = (): ApiClient => (client ??= createSessionClient(session(), { domain: partnerDomain() }))

export const restOptions = (): RestOptions => ({ domain: partnerDomain() })

export const useSession = (): SessionState => {
  const current = session()
  return useSyncExternalStore(current.subscribe, current.getState)
}
