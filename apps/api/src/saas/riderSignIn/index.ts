import { releaseRiderDeliveries } from '#engine/modules/ownDelivery/index'
import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { CodeCheck } from '#auth/codeCheck'
import { createRiderAuth } from '#auth/riderAuth'
import { smsCodeMs } from '#auth/storeCodes'
import { logEvent } from '#core/log'
import { withSystemScope } from '#db/scoped/index'
import { selectStoreName } from '#db/scoped/shopper'
import { queueSms } from '#saas/sms/index'

// A rider asking for a sign-in code (DELIVERY §4): the answer comes back at once, the same for every number, and the
// look-up, the code row and its text happen after it, so neither the answer nor its timing says who is invited.

export interface RiderSignInDeps {
  sql: postgres.Sql
  storeId: string
  partnerId: string
  activity: ActivityLog
  facts: RequestFacts
  allowAttempt: (key: string) => Promise<boolean>
  codeCheck?: CodeCheck
  /** Runs work past the response (the Worker's `waitUntil`). */
  defer: (work: Promise<unknown>) => void
  now: () => Date
}

export const riderSignInAudit = { codeRequested: 'rider.code_requested' } as const

export const createRiderSignIn = (deps: RiderSignInDeps) => {
  // A rider holding a picked-up parcel is refused RIDER_HAS_PARCEL and stays signed in (DELIVERY §4).
  const auth = createRiderAuth({ ...deps, beforeSignOut: (tx, riderId) => releaseRiderDeliveries(tx, { storeId: deps.storeId, partnerId: deps.partnerId, activity: deps.activity, facts: deps.facts, now: deps.now(), actor: { actorKind: 'rider', actorId: riderId, actorLabel: null } }, riderId, 'sign_out') })

  const requestCode = async (raw: string): Promise<{ ok: true } | { ok: false; reason: 'INVALID_INPUT' | 'RATE_LIMITED' }> => {
    const checked = await auth.checkRequest(raw)
    if (!checked.ok) return checked
    const work = withSystemScope(deps.sql, async (tx) => {
      const made = await auth.makeCode(tx, checked.phone)
      if (made) {
        const brand = ((await selectStoreName(tx, deps.storeId)) ?? 'Your shop').slice(0, 30)
        const expiresAt = new Date(deps.now().getTime() + smsCodeMs).toISOString()
        // The shoppers' sign-in wording, word for word, so partners register no new template (THIRD-PARTY-ACCESS §4).
        await queueSms(tx, { partnerId: deps.partnerId, storeId: deps.storeId, idempotencyKey: `rider-code:${made.codeId}`, payload: { message: 'code.shopper_sign_in', to: made.phone, brand, vars: { code: made.code }, expiresAt } })
      }
      // Every request alike, never the number (LOGGING §4.1).
      await deps.activity.record(tx, {
        category: 'auth',
        action: riderSignInAudit.codeRequested,
        result: 'success',
        actorKind: 'anonymous',
        actorId: null,
        actorLabel: null,
        partnerId: deps.partnerId,
        storeId: deps.storeId,
        target: null,
        reason: null,
        api: 'delivery',
        visibility: 'store',
        ...deps.facts,
      })
    })
    deps.defer(work.catch((error: unknown) => logEvent({ event: 'rider_code_failed', api: 'delivery', storeId: deps.storeId, code: error instanceof Error ? error.name : 'unknown' })))
    return { ok: true }
  }

  return { requestCode, signIn: auth.signIn, signOut: auth.signOut }
}
