import { createContext, useContext } from 'react'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import type { Rider } from '../api/rider'

export type Session = {
  host: string
  /** The Delivery API, carrying the rider's token. A call the API answers `UNAUTHENTICATED` ends the session. */
  client: ApiClient
  /** Whether a token is held. The API still decides whether it is any good. */
  signedIn: boolean
  /** Keeps the token `signIn` answers; the next call carries it. */
  startSession: (token: string) => Promise<void>
  /** Ends the session on the server, then removes the token. Refused `RIDER_HAS_PARCEL` while the rider carries a parcel; with no signal the token goes anyway. */
  signOut: () => Promise<void>
  /** Removes the token without asking the server: the session is already over (the account is deleted, or the API said so). */
  leave: () => Promise<void>
  /** The rider's own profile. A token the API reads as signed out ends the session and is refused `UNAUTHENTICATED`. */
  fetchRider: () => Promise<Rider>
  /** The photo as the raw image, answering the asset's id. */
  uploadPhoto: (uri: string, mimeType: string) => Promise<string>
}

export const SessionContext = createContext<Session | null>(null)

export const useSession = (): Session => {
  const session = useContext(SessionContext)
  if (!session) throw new Error('useSession needs a SessionProvider above it.')
  return session
}
