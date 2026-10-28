import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { storeHost } from '@dripfunnel/mobile-shared/brand'
import { ApiError, isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { uploadPhoto } from '../api/photo'
import { createDeliveryClient } from '../api/client'
import { fetchMe, signOut as signOutOnServer } from '../api/rider'
import { SessionContext, type Session } from './SessionContext'
import { clearToken, loadToken, saveToken } from './token'

// One client for the screens: it reads the token on every call, so a sign-in reaches it at once.
export function SessionProvider({ children }: { children: ReactNode }) {
  const [host, setHost] = useState<string | null>(null)
  const [signedIn, setSignedIn] = useState(false)
  const token = useRef<string | null>(null)

  useEffect(() => {
    let current = true
    const own = storeHost()
    loadToken(own).then((saved) => {
      if (!current) return
      token.current = saved
      setSignedIn(saved !== null)
      setHost(own)
    })
    return () => {
      current = false
    }
  }, [])

  const session = useMemo<Session | null>(() => {
    if (host === null) return null
    const leave = async () => {
      token.current = null
      setSignedIn(false)
      await clearToken(host)
    }
    const base = createDeliveryClient(host, { token: () => token.current })
    // Any call the API answers as signed out sends the rider back to getting in.
    const request: ApiClient['request'] = async (query, variables, options) => {
      try {
        return await base.request(query, variables, options)
      } catch (error) {
        if (token.current && isApiError(error, 'UNAUTHENTICATED')) await leave()
        throw error
      }
    }
    const client: ApiClient = { request }
    return {
      host,
      client,
      signedIn,
      startSession: async (value) => {
        token.current = value
        setSignedIn(true)
        await saveToken(host, value)
      },
      signOut: async () => {
        // A phone with no signal must still be able to sign out; only a parcel in hand keeps the session.
        await signOutOnServer(client).catch((error: unknown) => {
          if (isApiError(error, 'RIDER_HAS_PARCEL')) throw error
        })
        await leave()
      },
      leave,
      fetchRider: async () => {
        const rider = await fetchMe(client)
        if (rider) return rider
        await leave()
        throw new ApiError('UNAUTHENTICATED', 'The API reads this token as signed out.')
      },
      uploadPhoto: (uri, mimeType) => uploadPhoto({ host, token: token.current, uri, mimeType }),
    }
  }, [host, signedIn])

  return session ? <SessionContext.Provider value={session}>{children}</SessionContext.Provider> : null
}
