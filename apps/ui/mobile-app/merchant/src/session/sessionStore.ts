import { createApiClient, isApiError, type ApiClient, type ClientOptions } from '../graphql'

/** The store, and for a person working for more than one supplier in it the supplier, a request acts in (ACCESS.md §4). */
export type Acting = { storeId: string; supplierId: string | null; storeName: string; role: string; tier: string | null }

/** Why the sign-in screen is showing, when it isn't a plain start: the words come from messages/. */
export type Notice = 'signedOut' | 'expired' | 'noStores'

export type SessionState =
  | { status: 'starting' }
  | { status: 'signedOut'; notice: Notice | null }
  | { status: 'signedIn'; token: string; acting: Acting | null; last: Acting | null }

/** Where the token and the last store live: the phone's secure storage (REACT-NATIVE.md §5). */
export type SessionStorage = {
  read: () => Promise<{ token: string | null; last: Acting | null }>
  writeToken: (token: string) => Promise<void>
  writeLast: (last: Acting) => Promise<void>
  wipe: () => Promise<void>
}

// Only a full session is kept: the pending one a password opens before the second factor lives in memory
// (features/auth/pending.ts), so a killed app never wakes up half signed in. Everything is wiped on sign-out
// and on expiry, never replayed under another session (ARCHITECTURE.md §5).
export const createSessionStore = (storage: SessionStorage) => {
  let state: SessionState = { status: 'starting' }
  const listeners = new Set<() => void>()
  const set = (next: SessionState) => {
    state = next
    listeners.forEach((listener) => listener())
  }

  return {
    getState: (): SessionState => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => void listeners.delete(listener)
    },
    token: (): string | null => (state.status === 'signedIn' ? state.token : null),
    acting: (): Acting | null => (state.status === 'signedIn' ? state.acting : null),

    /** Step 4 of ARCHITECTURE.md §4: a saved token, or none. */
    async restore(): Promise<void> {
      const saved = await storage.read()
      set(saved.token ? { status: 'signedIn', token: saved.token, acting: null, last: saved.last } : { status: 'signedOut', notice: null })
    },

    async open(token: string): Promise<void> {
      await storage.writeToken(token)
      set({ status: 'signedIn', token, acting: null, last: state.status === 'signedIn' ? state.last : null })
    },

    async act(acting: Acting): Promise<void> {
      if (state.status !== 'signedIn') return
      await storage.writeLast(acting)
      set({ ...state, acting, last: acting })
    },

    /** Back to the chooser, keeping the session (Switch store). */
    leaveStore(): void {
      if (state.status === 'signedIn') set({ ...state, acting: null })
    },

    async end(notice: Notice | null): Promise<void> {
      await storage.wipe()
      set({ status: 'signedOut', notice })
    },
  }
}

export type SessionStore = ReturnType<typeof createSessionStore>

/** A client for a signed-in person: it carries the session, and an answer of UNAUTHENTICATED ends the session. */
export const createSessionClient = (session: SessionStore, options: Omit<ClientOptions, 'token' | 'store' | 'supplier'>): ApiClient => {
  const client = createApiClient({ ...options, token: session.token, store: () => session.acting()?.storeId ?? null, supplier: () => session.acting()?.supplierId ?? null })
  return {
    async request<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
      try {
        return await client.request<T>(query, variables)
      } catch (error) {
        if (isApiError(error, 'UNAUTHENTICATED')) await session.end('expired')
        throw error
      }
    },
  }
}
