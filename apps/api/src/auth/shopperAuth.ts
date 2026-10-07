import type postgres from 'postgres'
import { isE164 } from '#core/sms'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  countCodeAttempt,
  countRecentCodes,
  endShopperSession,
  endShopperSessions,
  insertCode,
  insertShopper,
  insertShopperSession,
  proveShopper,
  selectCustomerAuth,
  selectLiveCode,
  selectShopperBy,
  setCodeHash,
  spendCode,
  touchShopperSession,
} from '#db/scoped/shopper'
import type { ActivityEntry, ActivityLog, RequestFacts } from './activity'
import { hashPassword, minPasswordLength, verifyPassword } from './password'
import { hashSessionId, newSessionId } from './session'
import { hashSmsCode, maxSmsCodeAttempts, maxSmsCodesPer10Min, newSmsCode, smsCodeMs } from './storeCodes'

// A store's shoppers signing in (ACCESS §2.1): email and password, a code by email or text, or both, as Settings ›
// Customer accounts says. In system scope, as no shopper exists yet; every query names the store. Answers never say
// whether an account exists, and a wrong, missing or expired code is one refusal.

export const shopperSessionMs = 30 * 86_400_000
const tenMinutes = 10 * 60 * 1000

export type ShopperChannel = 'email' | 'phone'

export type CodeAsked =
  | { ok: true; codeId: string; channel: ShopperChannel; target: string; code: string | null }
  | { ok: false; reason: 'METHOD_OFF' | 'INVALID_INPUT' | 'RATE_LIMITED' }
export type SignedIn = { ok: true; token: string; customerId: string; created: boolean } | { ok: false; reason: 'METHOD_OFF' | 'INVALID_INPUT' | 'CODE_REFUSED' | 'SIGN_IN_REFUSED' | 'RATE_LIMITED' | 'WEAK_PASSWORD' }

export interface ShopperAuthDeps {
  sql: postgres.Sql
  storeId: string
  partnerId: string
  activity: ActivityLog
  facts: RequestFacts
  /** The sign-in limiter (SIGN_IN_RATE_LIMITER), per store and IP and per store and email. */
  allowAttempt: (key: string) => Promise<boolean>
  now: () => Date
}

const emailPattern = /^[^\s@]{1,64}@[^\s@]{1,253}\.[^\s@]{2,}$/

/** An email in lower case, or a number in E.164; null for one that can't be. */
export const shopperTarget = (channel: ShopperChannel, raw: string): string | null => {
  if (channel === 'email') {
    const email = raw.trim().toLowerCase()
    return email.length <= 254 && emailPattern.test(email) ? email : null
  }
  const phone = raw.trim().replaceAll(/[\s()-]/g, '')
  return isE164(phone) ? phone : null
}

/** An email or number as a limiter key: its digest, so no address leaves for the limiter. */
const limiterKeyOf = (target: string) => hashSessionId(`shopper-limit:${target}`)

// Salted by the code's own row, as a merchant's are (storeCodes.ts).
export const hashShopperCode = (codeId: string, code: string) => hashSmsCode(`shopper:${codeId}`, code)

export const createShopperAuth = ({ sql, storeId, partnerId, activity, facts, allowAttempt, now }: ShopperAuthDeps) => {
  const entry = (action: string, customerId: string | null, result: 'success' | 'failed' = 'success'): ActivityEntry => ({
    category: action.startsWith('customer.sign') ? 'auth' : 'write',
    action,
    result,
    actorKind: customerId ? 'customer' : 'anonymous',
    actorId: customerId,
    actorLabel: null,
    partnerId,
    storeId,
    customerId,
    target: customerId ? { type: 'customer', id: customerId, label: 'Shopper' } : null,
    reason: null,
    api: 'shop',
    visibility: 'store',
    ...facts,
  })

  const allowed = async (tx: ScopedSql, channel: ShopperChannel) => {
    const auth = await selectCustomerAuth(tx, storeId)
    return channel === 'email' ? auth.email_enabled : auth.phone_enabled
  }

  /**
   * "Send me a code": the same answer whether or not the address has an account. A text's code is made now and goes in
   * the text; an email's is made when the email is sent (saas/email), so the caller queues it and never sees it.
   */
  const askCode = (tx: ScopedSql, channel: ShopperChannel, raw: string, requester: string | null): Promise<CodeAsked> =>
    (async (): Promise<CodeAsked> => {
      const target = shopperTarget(channel, raw)
      if (!target) return { ok: false, reason: 'INVALID_INPUT' }
      if (!(await allowed(tx, channel))) return { ok: false, reason: 'METHOD_OFF' }
      const since = new Date(now().getTime() - tenMinutes)
      // Per requester through the limiter, which keeps no address; a request with none (off Cloudflare) is refused.
      if (!requester || !(await allowAttempt(`shop:${storeId}:code-ip:${requester}`))) return { ok: false, reason: 'RATE_LIMITED' }
      if ((await countRecentCodes(tx, storeId, { channel, target }, since)) >= maxSmsCodesPer10Min) return { ok: false, reason: 'RATE_LIMITED' }
      const expiresAt = new Date(now().getTime() + smsCodeMs)
      const codeId = await insertCode(tx, { storeId, channel, target, codeHash: null, expiresAt })
      if (channel === 'email') return { ok: true, codeId, channel, target, code: null }
      const code = newSmsCode()
      await setCodeHash(tx, codeId, await hashShopperCode(codeId, code), expiresAt, now())
      return { ok: true, codeId, channel, target, code }
    })()

  const startSession = async (tx: ScopedSql, customerId: string): Promise<string> => {
    const token = newSessionId()
    await insertShopperSession(tx, { idHash: await hashSessionId(token), storeId, customerId, expiresAt: new Date(now().getTime() + shopperSessionMs), now: now() })
    return token
  }

  /**
   * A code proves the email or number: an account is made for one that has none, signed in for one that has. A password
   * given with an email's code becomes the account's (sign-up, or a forgotten one).
   */
  const verifyCode = (channel: ShopperChannel, raw: string, code: string, extra: { name?: string | null | undefined; password?: string | null | undefined }): Promise<SignedIn> =>
    withSystemScope(sql, async (tx): Promise<SignedIn> => {
      const target = shopperTarget(channel, raw)
      const name = extra.name?.trim() || null
      if (!target || (name?.length ?? 0) > 200 || !/^\d{6}$/.test(code.trim())) return { ok: false, reason: 'INVALID_INPUT' }
      // Guessing is bounded per code (5 tries) and per requester and address here, as signIn is.
      if (!facts.ip || !(await allowAttempt(`shop:${storeId}:verify-ip:${facts.ip}`)) || !(await allowAttempt(`shop:${storeId}:verify:${channel}:${await limiterKeyOf(target)}`))) return { ok: false, reason: 'RATE_LIMITED' }
      if (extra.password && (extra.password.length < minPasswordLength || extra.password.length > 200)) return { ok: false, reason: 'WEAK_PASSWORD' }
      if (!(await allowed(tx, channel))) return { ok: false, reason: 'METHOD_OFF' }
      const live = await selectLiveCode(tx, storeId, channel, target, now())
      const refused = async (): Promise<SignedIn> => {
        // Recorded as a failed sign-in with no address, as signIn's are (LOGGING §3).
        await activity.record(tx, entry('customer.sign_in_failed', null, 'failed'))
        return { ok: false, reason: 'CODE_REFUSED' }
      }
      if (!live || live.attempts >= maxSmsCodeAttempts || !live.code_hash) return refused()
      if (live.code_hash !== (await hashShopperCode(live.id, code.trim()))) {
        await countCodeAttempt(tx, live.id)
        return refused()
      }
      await spendCode(tx, live.id, now())
      const passwordHash = channel === 'email' && extra.password ? await hashPassword(extra.password) : null
      const found = await selectShopperBy(tx, storeId, channel, target)
      if (found?.status === 'deleted') return refused()
      let customerId = found?.id ?? null
      if (customerId) {
        await proveShopper(tx, customerId, channel, passwordHash, now())
        if (passwordHash) {
          // A new password ends every other session, as a reset must (ACCESS §2).
          await endShopperSessions(tx, customerId, storeId, now())
          await activity.record(tx, entry('customer.password_changed', customerId))
        }
      } else {
        customerId = await insertShopper(tx, { storeId, channel, target, name, passwordHash, now: now() })
        await activity.record(tx, entry('customer.signed_up', customerId))
      }
      await activity.record(tx, entry('customer.signed_in', customerId))
      return { ok: true, token: await startSession(tx, customerId), customerId, created: !found }
    })

  /** Email and password: one refusal for an unknown email, a wrong password and an account without one (ACCESS §2). */
  const signIn = async (rawEmail: string, password: string): Promise<SignedIn> => {
    const email = shopperTarget('email', rawEmail)
    if (!email || password.length === 0 || password.length > 200) return { ok: false, reason: 'INVALID_INPUT' }
    if (!facts.ip || !(await allowAttempt(`shop:${storeId}:ip:${facts.ip}`)) || !(await allowAttempt(`shop:${storeId}:email:${await limiterKeyOf(email)}`))) return { ok: false, reason: 'RATE_LIMITED' }
    return withSystemScope(sql, async (tx): Promise<SignedIn> => {
      if (!(await allowed(tx, 'email'))) return { ok: false, reason: 'METHOD_OFF' }
      const found = await selectShopperBy(tx, storeId, 'email', email)
      const ok = await verifyPassword(password, found?.password_hash ?? null)
      if (!found || !ok || found.status !== 'active') {
        await activity.record(tx, entry('customer.sign_in_failed', found?.id ?? null, 'failed'))
        return { ok: false, reason: 'SIGN_IN_REFUSED' }
      }
      await activity.record(tx, entry('customer.signed_in', found.id))
      return { ok: true, token: await startSession(tx, found.id), customerId: found.id, created: false }
    })
  }

  const signOut = (token: string) =>
    withSystemScope(sql, async (tx) => {
      const customerId = /^[0-9a-f]{64}$/.test(token) ? await endShopperSession(tx, await hashSessionId(token), storeId, now()) : null
      if (customerId) await activity.record(tx, entry('customer.signed_out', customerId))
      return true as const
    })

  return { askCode, verifyCode, signIn, signOut }
}

/** The signed-in shopper a session token names in this store, its session moved on; null for any other. */
export const resolveShopperSession = async (sql: postgres.Sql, storeId: string, token: string, now: Date): Promise<string | null> =>
  /^[0-9a-f]{64}$/.test(token) ? withSystemScope(sql, async (tx) => touchShopperSession(tx, await hashSessionId(token), storeId, now, new Date(now.getTime() + shopperSessionMs))) : null
