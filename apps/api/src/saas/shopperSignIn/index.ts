import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { CodeCheck } from '#auth/codeCheck'
import { createShopperAuth, type CodeAsked, type ShopperChannel } from '#auth/shopperAuth'
import { smsCodeMs } from '#auth/storeCodes'
import { withSystemScope } from '#db/scoped/index'
import type { ScopedSql } from '#db/scoped/index'
import { selectShopperBy, selectStoreName } from '#db/scoped/shopper'
import { queueSideEffect } from '#saas/outbox/index'
import { queueSms } from '#saas/sms/index'

// A shopper asking for a sign-in code (ACCESS §2.1): the code row and its text or email in one transaction, so a code is
// never sent without its row, nor a row left with no message (api/README.md §5).

export interface ShopperSignInDeps {
  sql: postgres.Sql
  storeId: string
  partnerId: string
  activity: ActivityLog
  facts: RequestFacts
  allowAttempt: (key: string) => Promise<boolean>
  codeCheck?: CodeCheck
  now: () => Date
}

export const shopperSignInAudit = { codeRequested: 'customer.code_requested' } as const

export const createShopperSignIn = (deps: ShopperSignInDeps) => {
  const auth = createShopperAuth(deps)

  /** The code's text or email, queued with its row. */
  const send = async (tx: ScopedSql, asked: Extract<CodeAsked, { ok: true }>) => {
    const key = `shopper-code:${asked.codeId}`
    if (asked.code !== null) {
      const brand = ((await selectStoreName(tx, deps.storeId)) ?? 'Your shop').slice(0, 30)
      const expiresAt = new Date(deps.now().getTime() + smsCodeMs).toISOString()
      await queueSms(tx, { partnerId: deps.partnerId, storeId: deps.storeId, idempotencyKey: key, payload: { message: 'code.shopper_sign_in', to: asked.target, brand, vars: { code: asked.code }, expiresAt } })
    } else {
      await queueSideEffect(tx, { kind: 'email', idempotencyKey: key, payload: { template: 'shopper-code', customerCodeId: asked.codeId }, partnerId: deps.partnerId, storeId: deps.storeId })
    }
  }

  // No address in the entry: who asked is the request's facts, what for a code (LOGGING §4.1).
  const recorded = (tx: ScopedSql, channel: ShopperChannel, customerId: string | null) =>
    deps.activity.record(tx, {
      category: 'auth',
      action: shopperSignInAudit.codeRequested,
      result: 'success',
      actorKind: customerId ? 'customer' : 'anonymous',
      actorId: customerId,
      actorLabel: null,
      partnerId: deps.partnerId,
      storeId: deps.storeId,
      customerId,
      target: null,
      reason: channel,
      api: 'shop',
      visibility: 'store',
      ...deps.facts,
    })

  /** The same answer whether or not an account exists; a limit reached is said plainly, as it says nothing of one. */
  const requestCode = (channel: ShopperChannel, to: string) =>
    withSystemScope(deps.sql, async (tx) => {
      const asked = await auth.askCode(tx, channel, to, deps.facts.ip)
      if (!asked.ok) return asked
      await send(tx, asked)
      await recorded(tx, channel, null)
      return { ok: true as const }
    })

  /**
   * A signed-in shopper's code for a new number (#1404). One that another account holds is counted and answered like any
   * other but never texted, so the answer says nothing of that account (ACCESS §2.1).
   */
  const requestPhoneChange = (customerId: string, to: string) =>
    withSystemScope(deps.sql, async (tx) => {
      const asked = await auth.askCode(tx, 'phone', to, deps.facts.ip)
      if (!asked.ok) return asked
      const holder = await selectShopperBy(tx, deps.storeId, 'phone', asked.target)
      if (!holder || holder.id === customerId) await send(tx, asked)
      await recorded(tx, 'phone', customerId)
      return { ok: true as const }
    })

  return { requestCode, requestPhoneChange, verifyCode: auth.verifyCode, changePhone: auth.changePhone, signIn: auth.signIn, signOut: auth.signOut }
}
