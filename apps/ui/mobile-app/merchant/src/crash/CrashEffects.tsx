import { useEffect } from 'react'
import { z } from 'zod'
import { crashReportingIsSetUp, setReportingStore, setReportingUser, startReporting } from '@dripfunnel/mobile-shared/crash'
import { typedQuery } from '@dripfunnel/mobile-shared/graphql'
import { sessionClient, useSession } from '../session'

const idAnswer = z.object({ me: z.object({ id: z.string().nullable() }).nullable() })

/** Mounted once under the session: collection starts, and the signed-in person's opaque id and the acting store's go with later reports; nothing else about either. */
export function CrashEffects() {
  const state = useSession()
  const signedIn = state.status === 'signedIn'
  const storeId = state.status === 'signedIn' ? (state.acting?.storeId ?? null) : null

  useEffect(() => {
    startReporting()
  }, [])

  useEffect(() => {
    setReportingStore(storeId)
  }, [storeId])

  useEffect(() => {
    if (!crashReportingIsSetUp()) return
    if (!signedIn) return setReportingUser(null)
    let current = true
    typedQuery(sessionClient())('{ me { id } }', idAnswer)
      .then((data) => current && setReportingUser(data.me?.id ?? null))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [signedIn])

  return null
}
