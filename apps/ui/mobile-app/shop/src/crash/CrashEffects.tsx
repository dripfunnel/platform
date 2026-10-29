import { useEffect } from 'react'
import { z } from 'zod'
import { crashReportingIsSetUp, setReportingUser, startReporting } from '@dripfunnel/mobile-shared/crash'
import { decode } from '@dripfunnel/mobile-shared/graphql'
import { useShop } from '../api/ShopContext'

const idAnswer = z.object({ account: z.object({ id: z.string().nullable() }).nullable() })

/** Mounted once under the providers: collection starts, and the signed-in customer's opaque id (the account's, not a person's detail) goes with later reports; a guest has none. */
export function CrashEffects() {
  const { signedIn, client } = useShop()

  useEffect(() => {
    startReporting()
  }, [])

  useEffect(() => {
    if (!crashReportingIsSetUp()) return
    if (!signedIn) return setReportingUser(null)
    let current = true
    client
      .request<unknown>('{ account { id } }')
      .then((data) => current && setReportingUser(decode(idAnswer, data).account?.id ?? null))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [signedIn, client])

  return null
}
