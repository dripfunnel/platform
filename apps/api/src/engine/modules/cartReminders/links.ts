import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { hashSessionId, newSessionId } from '#auth/session'
import type { TenantContext } from '#core/tenancy'
import { unsubscribeLinkMs } from '#db/scoped/cart'
import { recordUnsubscribed, restoreFromReminder, selectReminderByToken, selectReminderCustomer } from '#db/scoped/cartReminders'
import { withSystemScope } from '#db/scoped/index'
import { ensureGuestCustomer } from '#db/scoped/storeCustomers'

// A reminder's two links on the storefront (FIRST-RELEASE §19): `cart/r/{token}` opens its cart, `unsubscribe/{token}` stops
// the shopper's marketing. Each token opens one cart or one consent in its own store only, looked up in system scope by
// its hash, and answers one refusal whether it is unknown here, expired or no longer usable.

export type LinkResult<T> = { ok: true; value: T } | { ok: false; reason: 'LINK_INVALID' }

export interface LinkDeps {
  sql: postgres.Sql
  /** The storefront's shopper: the store is the host's, never the link's. */
  context: TenantContext
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

const tokenShape = /^[0-9a-f]{64}$/

export interface Restored {
  /** A guest's cart's new token, handed back once (X-Shop-Cart); null for an account's cart. */
  token: string | null
  /** The cart is an account's that isn't this shopper's: they sign in to see it. */
  signInRequired: boolean
}

/** "Return to your cart": records the click, adds the reminder's code, and gives a guest's cart to this browser. */
export const restoreCart = async ({ sql, context, now }: LinkDeps, raw: string): Promise<LinkResult<Restored>> => {
  const token = raw.trim().toLowerCase()
  if (!tokenShape.test(token)) return { ok: false, reason: 'LINK_INVALID' }
  const hash = await hashSessionId(token)
  const shopperId = context.caller.kind === 'shopper' ? context.caller.customerId : null
  return withSystemScope(sql, async (tx): Promise<LinkResult<Restored>> => {
    const at = now()
    const found = await selectReminderByToken(tx, context.storeId, hash, at)
    if (!found?.cart_open) return { ok: false, reason: 'LINK_INVALID' }
    const held = found.codes.some((c) => c.toLowerCase() === found.code?.toLowerCase())
    const codes = found.code && !held && found.codes.length < 5 ? [...found.codes, found.code] : found.codes
    const guest = found.customer_id === null
    const next = guest ? newSessionId() : null
    await restoreFromReminder(tx, { reminderId: found.id, orderId: found.order_id, codes, tokenHash: next ? await hashSessionId(next) : null, now: at })
    return { ok: true, value: { token: next, signInRequired: !guest && found.customer_id !== shopperId } }
  })
}

/**
 * "Unsubscribe": the shopper's customer row stops all marketing, as the store's own "asked to stop" does; a guest without
 * one gets one, so the answer is remembered. Saying it twice is the same answer; the link works 30 days after sending.
 */
export const unsubscribe = async ({ sql, context, activity, facts, now }: LinkDeps, raw: string): Promise<LinkResult<true>> => {
  const token = raw.trim().toLowerCase()
  if (!tokenShape.test(token)) return { ok: false, reason: 'LINK_INVALID' }
  const hash = await hashSessionId(token)
  return withSystemScope(sql, async (tx): Promise<LinkResult<true>> => {
    const at = now()
    const found = await selectReminderByToken(tx, context.storeId, hash, at)
    if (!found || found.sent_at.getTime() <= at.getTime() - unsubscribeLinkMs) return { ok: false, reason: 'LINK_INVALID' }
    let customerId = await selectReminderCustomer(tx, context.storeId, found.customer_id, found.email)
    if (!customerId && found.email) {
      await ensureGuestCustomer(tx, { storeId: context.storeId, email: found.email, phone: null, name: null, now: at })
      customerId = await selectReminderCustomer(tx, context.storeId, null, found.email)
    }
    if (!customerId) return { ok: false, reason: 'LINK_INVALID' }
    const before = await recordUnsubscribed(tx, context.storeId, customerId, at)
    if (before === null || before === 'stopped') return { ok: true, value: true }
    const entry: ActivityEntry = {
      category: 'write',
      action: 'customer.consent_recorded',
      result: 'success',
      actorKind: 'anonymous',
      actorId: null,
      actorLabel: null,
      partnerId: context.partnerId,
      storeId: context.storeId,
      customerId,
      target: { type: 'customer', id: customerId, label: 'Unsubscribed from a cart reminder' },
      reason: null,
      changes: [{ field: 'consent', before, after: 'stopped' }],
      api: 'shop',
      visibility: 'store',
      ...facts,
    }
    await activity.record(tx, entry)
    return { ok: true, value: true }
  })
}
