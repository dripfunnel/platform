import { useEffect } from 'react'
import { z } from 'zod'
import { crashReportingIsSetUp, setReportingUser, startReporting } from '@dripfunnel/mobile-shared/crash'
import { decode } from '@dripfunnel/mobile-shared/graphql'
import { useSession } from '../session/SessionContext'

const idAnswer = z.object({ me: z.object({ id: z.string() }).nullable() })

/** Mounted once under the session: collection starts, and the signed-in rider's opaque id (never the name or phone) goes with later reports. */
export function CrashEffects() {
  const { signedIn, client } = useSession()

  useEffect(() => {
    startReporting()
  }, [])

  useEffect(() => {
    if (!crashReportingIsSetUp()) return
    if (!signedIn) return setReportingUser(null)
    let current = true
    client
      .request<unknown>('{ me { id } }')
      .then((data) => current && setReportingUser(decode(idAnswer, data).me?.id ?? null))
      .catch(() => undefined)
    return () => {
      current = false
    }
  }, [signedIn, client])

  return null
}
