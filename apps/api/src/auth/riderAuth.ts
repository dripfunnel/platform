import type postgres from 'postgres'
import { selectStoreEntitlement } from '#db/scoped/entitlements'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  activateRider,
  countRecentRiderCodes,
  countRiderCodeAttempt,
  countStoreRiderCodes,
  endRiderSession,
  insertRiderCode,
  insertRiderSession,
  selectLiveRiderCode,
  selectRiderByPhone,
  setRiderCodeHash,
  spendRiderCode,
  touchRiderSession,
} from '#db/scoped/riderSignIn'
import type { ActivityEntry, ActivityLog, RequestFacts } from './activity'
import { codeMatches, type CodeCheck } from './codeCheck'
import { hashSessionId, newSessionId } from './session'
import { shopperTarget } from './shopperAuth'
import { hashSmsCode, maxSmsCodeAttempts, maxSmsCodesPer10Min, newSmsCode, smsCodeMs } from './storeCodes'

// A store's riders signing in by a texted code (DELIVERY §4, §5), with shoppers' limits (ACCESS §2.1). In system scope, as
// no rider is signed in yet; every query names the store. Only an invited or active rider's number is ever texted, and
// every other number is answered the same.

export const riderSessionMs = 30 * 86_400_000
/** Codes one store may text riders in ten minutes, whoever asks (DELIVERY §4). */
export const maxStoreRiderCodesPer10Min = 50
const tenMinutes = 10 * 60 * 1000

export type RiderCodeAsked = { ok: true; send: { codeId: string; phone: string; code: string } | null } | { ok: false; reason: 'INVALID_INPUT' | 'RATE_LIMITED' }
export type RiderSignedIn = { ok: true; token: string; riderId: string } | { ok: false; reason: 'INVALID_INPUT' | 'RATE_LIMITED' | 'CODE_REFUSED' | 'RIDER_SUSPENDED' }

export interface RiderAuthDeps {
  sql: postgres.Sql
  storeId: string
  partnerId: string
  activity: ActivityLog
  facts: RequestFacts
  /** The sign-in limiter (SIGN_IN_RATE_LIMITER), per store and address and per store and number. */
  allowAttempt: (key: string) => Promise<boolean>
  codeCheck?: CodeCheck
  now: () => Date
}

// Salted by the code's own row, as shoppers' are.
export const hashRiderCode = (codeId: string, code: string) => hashSmsCode(`rider:${codeId}`, code)

/** A number as a limiter key: its digest, so no number leaves for the limiter. */
const limiterKeyOf = (phone: string) => hashSessionId(`rider-limit:${phone}`)

const ownDeliveryOn = async (tx: ScopedSql, storeId: string, now: Date) => (await selectStoreEntitlement(tx, storeId, 'own_delivery', now)).enabled === true

export const createRiderAuth = ({ sql, storeId, partnerId, activity, facts, allowAttempt, codeCheck, now }: RiderAuthDeps) => {
  const entry = (action: string, rider: { id: string; name: string } | null, result: 'success' | 'failed' = 'success'): ActivityEntry => ({
    category: 'auth',
    action,
    result,
    actorKind: rider ? 'rider' : 'anonymous',
    actorId: rider?.id ?? null,
    actorLabel: rider?.name ?? null,
    partnerId,
    storeId,
    target: rider ? { type: 'rider', id: rider.id, label: rider.name } : null,
    reason: null,
    api: 'delivery',
    visibility: 'store',
    ...facts,
  })

  /** Only the address limit is said: it says nothing of the number. */
  const checkRequest = async (raw: string): Promise<{ ok: true; phone: string } | { ok: false; reason: 'INVALID_INPUT' | 'RATE_LIMITED' }> => {
    const phone = shopperTarget('phone', raw)
    if (!phone) return { ok: false, reason: 'INVALID_INPUT' }
    if (!facts.ip || !(await allowAttempt(`delivery:${storeId}:code-ip:${facts.ip}`))) return { ok: false, reason: 'RATE_LIMITED' }
    return { ok: true, phone }
  }

  /** A code for an invited or active rider within the limits and the plan; null for every other number, sent nothing. */
  const makeCode = async (tx: ScopedSql, phone: string): Promise<{ codeId: string; phone: string; code: string } | null> => {
    const rider = await selectRiderByPhone(tx, storeId, phone)
    if (!rider || (rider.status !== 'invited' && rider.status !== 'active')) return null
    if (!(await ownDeliveryOn(tx, storeId, now()))) return null
    const since = new Date(now().getTime() - tenMinutes)
    if ((await countRecentRiderCodes(tx, storeId, phone, since)) >= maxSmsCodesPer10Min) return null
    if ((await countStoreRiderCodes(tx, storeId, since)) >= maxStoreRiderCodesPer10Min) return null
    const codeId = await insertRiderCode(tx, { storeId, phone, expiresAt: new Date(now().getTime() + smsCodeMs), now: now() })
    const code = newSmsCode()
    await setRiderCodeHash(tx, codeId, await hashRiderCode(codeId, code))
    return { codeId, phone, code }
  }

  const startSession = async (tx: ScopedSql, riderId: string): Promise<string> => {
    const token = newSessionId()
    await insertRiderSession(tx, { idHash: await hashSessionId(token), storeId, riderId, expiresAt: new Date(now().getTime() + riderSessionMs), now: now() })
    return token
  }

  /** One refusal for a wrong, spent, expired or never-sent code, and for a number that is no rider's. */
  const signIn = async (raw: string, code: string): Promise<RiderSignedIn> => {
    const phone = shopperTarget('phone', raw)
    if (!phone || !/^\d{6}$/.test(code.trim())) return { ok: false, reason: 'INVALID_INPUT' }
    if (!facts.ip || !(await allowAttempt(`delivery:${storeId}:verify-ip:${facts.ip}`)) || !(await allowAttempt(`delivery:${storeId}:verify:${await limiterKeyOf(phone)}`))) {
      return { ok: false, reason: 'RATE_LIMITED' }
    }
    return withSystemScope(sql, async (tx): Promise<RiderSignedIn> => {
      const refused = async (): Promise<RiderSignedIn> => {
        await activity.record(tx, entry('rider.sign_in_failed', null, 'failed'))
        return { ok: false, reason: 'CODE_REFUSED' }
      }
      const live = await selectLiveRiderCode(tx, storeId, phone, now())
      if (!live || live.attempts >= maxSmsCodeAttempts || !live.code_hash) return refused()
      if (!codeMatches(live.code_hash === (await hashRiderCode(live.id, code.trim())), codeCheck)) {
        await countRiderCodeAttempt(tx, live.id)
        return refused()
      }
      await spendRiderCode(tx, live.id, now())
      const rider = await selectRiderByPhone(tx, storeId, phone)
      if (!rider || !(await ownDeliveryOn(tx, storeId, now()))) return refused()
      if (rider.status === 'suspended') {
        await activity.record(tx, entry('rider.sign_in_failed', rider, 'failed'))
        return { ok: false, reason: 'RIDER_SUSPENDED' }
      }
      if (rider.status === 'invited') {
        await activateRider(tx, storeId, rider.id, now())
        await activity.record(tx, entry('rider.joined', rider))
      }
      await activity.record(tx, entry('rider.signed_in', rider))
      return { ok: true, token: await startSession(tx, rider.id), riderId: rider.id }
    })
  }

  const signOut = (token: string) =>
    withSystemScope(sql, async (tx) => {
      const rider = /^[0-9a-f]{64}$/.test(token) ? await endRiderSession(tx, await hashSessionId(token), storeId, now()) : null
      if (rider) await activity.record(tx, entry('rider.signed_out', rider))
      return true as const
    })

  return { checkRequest, makeCode, signIn, signOut }
}

/** The active rider a session token names in this store, its session moved on; null for any other. */
export const resolveRiderSession = async (sql: postgres.Sql, storeId: string, token: string, now: Date): Promise<string | null> =>
  /^[0-9a-f]{64}$/.test(token) ? withSystemScope(sql, async (tx) => touchRiderSession(tx, await hashSessionId(token), storeId, now, new Date(now.getTime() + riderSessionMs))) : null
