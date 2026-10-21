import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import {
  countAbandonedCarts,
  finalSkips,
  insertReminder,
  lockCartToRemind,
  selectAbandonedCart,
  selectAbandonedCarts,
  selectCartReminders,
  selectCartSummary,
  setRemindersStopped,
  type AbandonedCartRow,
  type CartReminderRow,
  type CartSummaryRow,
  type CartTab,
} from '#db/scoped/cartReminders'
import { withScope, withSystemScope } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import { cartLinesNow, type CartLineNow } from '#engine/modules/cart/index'
import { cartRemindKind } from './jobs'
import { reminderPercents, reminderSteps, reminderWindowMs } from './rules'

// The Carts tab (FIRST-RELEASE §9; Carts): every merchant role reads the store's abandoned carts in its own store scope;
// Owner and Manager remind, stop and resume (ACCESS §5.1 `carts.write`), written in system scope naming the store.

export const cartsAudit = { reminderSent: 'cart.reminder_sent', stopped: 'cart.reminders_stopped', resumed: 'cart.reminders_resumed', testSent: 'cart.test_reminder_sent' } as const

/** Where a cart stands, as the tab's status pill reads it (Carts: recovered › stopped › no contact › opted out › …). */
export type CartStatus = 'recovered' | 'stopped' | 'no_contact' | 'opted_out' | 'skipped' | 'not_recovered' | 'reminded' | 'waiting'

export interface AbandonedCartView extends AbandonedCartRow {
  status: CartStatus
}

export interface AbandonedCartDetail extends AbandonedCartView {
  items: CartLineNow[]
  reminders: CartReminderRow[]
}

export type CartsRefusal = 'NOT_FOUND' | 'INVALID_INPUT' | 'READ_ONLY' | 'CANT_REMIND' | 'PLAN_LIMIT'
export type CartsResult<T> = { ok: true; value: T } | { ok: false; reason: Exclude<CartsRefusal, 'PLAN_LIMIT'> } | { ok: false; reason: 'PLAN_LIMIT'; needs: number }

export interface CartsDeps {
  sql: postgres.Sql
  context: TenantContext
  /** `email`: where a test reminder goes, the person's own address only. */
  actor: { id: string; partnerId: string; email: string }
  activity: ActivityLog
  facts: RequestFacts
  /** The store's `cart_reminders` index on its plan (saas/entitlements). */
  level: () => Promise<number>
  now: () => Date
}

/** The summary's window, in days (Carts: "Last 14 days"); at most a quarter. */
export const summaryDays = { fallback: 14, max: 90 } as const
export const maxStopNote = 200

const statusOf = (r: AbandonedCartRow, now: Date): CartStatus => {
  if (r.recovered_order_id) return 'recovered'
  if (r.stopped_at) return 'stopped'
  if (!r.email) return 'no_contact'
  if (r.opted_out) return 'opted_out'
  if (r.last_skip && finalSkips.includes(r.last_skip)) return 'skipped'
  if (new Date(r.abandoned_at).getTime() <= now.getTime() - reminderWindowMs) return 'not_recovered'
  return r.sent > 0 ? 'reminded' : 'waiting'
}

export const createCartsService = ({ sql, context, actor, activity, facts, level, now }: CartsDeps) => {
  const { storeId } = context
  const supplier = context.sellerScope.kind === 'seller'
  const readOnly = context.caller.kind === 'support' && context.caller.access === 'read'

  const entry = (action: string, target: { type: string; id: string; label: string }, reason: string | null = null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target,
    reason,
    changes: [],
    api: 'store',
    visibility: 'store',
    ...facts,
  })
  const cartTarget = (id: string) => ({ type: 'cart', id, label: 'Abandoned cart' })

  const list = async (tab: CartTab, search: string | null, window: PageWindow): Promise<AbandonedCartView[]> => {
    if (supplier) return []
    const at = now()
    const rows = await withScope(sql, context, (tx) => selectAbandonedCarts(tx, storeId, { tab, search: search?.trim().slice(0, 100) || null }, window, at, reminderWindowMs))
    return rows.map((r) => ({ ...r, status: statusOf(r, at) }))
  }

  const counts = (): Promise<Record<CartTab, number>> => (supplier ? Promise.resolve({ open: 0, recovered: 0, lost: 0 }) : withScope(sql, context, (tx) => countAbandonedCarts(tx, storeId, now(), reminderWindowMs)))

  const summary = async (days: number | null): Promise<CartsResult<CartSummaryRow & { days: number }>> => {
    const d = days ?? summaryDays.fallback
    if (!Number.isInteger(d) || d < 1 || d > summaryDays.max) return { ok: false, reason: 'INVALID_INPUT' }
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    const row = await withScope(sql, context, (tx) => selectCartSummary(tx, storeId, new Date(now().getTime() - d * 86_400_000)))
    return { ok: true, value: { ...row, days: d } }
  }

  /** One cart with its lines as they would be bought now and its reminders; null for one not abandoned here. */
  const detail = async (id: string): Promise<AbandonedCartDetail | null> => {
    if (supplier || !isUuid(id)) return null
    const at = now()
    const found = await withScope(sql, context, async (tx) => {
      const row = await selectAbandonedCart(tx, storeId, id.toLowerCase())
      return row ? { row, reminders: await selectCartReminders(tx, storeId, row.id) } : null
    })
    if (!found) return null
    const { row } = found
    const items = await cartLinesNow({ sql, storeId, partnerId: context.partnerId, language: row.language, currency: row.currency, marketId: row.market_id, features: {}, now }, row.cart_lines)
    return { ...row, status: statusOf(row, at), items, reminders: found.reminders }
  }

  const write = async <T>(work: () => Promise<CartsResult<T>>): Promise<CartsResult<T>> => {
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    return work()
  }

  /**
   * "Send reminder now": by email at once, even in quiet hours, with a single-use code if asked. Below the plan's every
   * reminder (level 2) a cart gets one reminder and no code (Pricing: "You send · 1 per cart").
   */
  const remindNow = (cartId: string, discountPercent: number | null) =>
    write(async (): Promise<CartsResult<string>> => {
      if (!isUuid(cartId) || (discountPercent !== null && !(reminderPercents as readonly number[]).includes(discountPercent))) return { ok: false, reason: 'INVALID_INPUT' }
      const index = await level()
      if (discountPercent !== null && index < 2) return { ok: false, reason: 'PLAN_LIMIT', needs: 2 }
      return withSystemScope(sql, async (tx): Promise<CartsResult<string>> => {
        const at = now()
        const cart = await lockCartToRemind(tx, storeId, cartId.toLowerCase(), at)
        if (!cart) return { ok: false, reason: 'NOT_FOUND' }
        if (!cart.open || cart.stopped || cart.recovered || !cart.contact) return { ok: false, reason: 'CANT_REMIND' }
        if (index < 2 && cart.queued > 0) return { ok: false, reason: 'PLAN_LIMIT', needs: 2 }
        const id = await insertReminder(tx, { storeId, orderId: cart.id, stepId: null, byUserId: actor.id, discountBps: discountPercent === null ? null : discountPercent * 100, now: at })
        if (!id) throw new Error('cart reminder: a reminder by hand was not inserted')
        await insertOutbox(tx, { kind: cartRemindKind, idempotencyKey: id, payload: { reminderId: id }, partnerId: cart.partner_id, storeId })
        await activity.record(tx, entry(cartsAudit.reminderSent, cartTarget(cart.id), discountPercent === null ? null : `${discountPercent}% code`))
        return { ok: true, value: id }
      })
    })

  /** "Stop reminders" for this cart, with the team's note; "Resume reminders" picks the schedule up again. */
  const setStopped = (cartId: string, stop: boolean, note: string | null) =>
    write(async (): Promise<CartsResult<true>> => {
      const text = note?.trim() || null
      if (!isUuid(cartId) || (text?.length ?? 0) > maxStopNote) return { ok: false, reason: 'INVALID_INPUT' }
      return withSystemScope(sql, async (tx): Promise<CartsResult<true>> => {
        const at = now()
        const cart = await lockCartToRemind(tx, storeId, cartId.toLowerCase(), at)
        if (!cart) return { ok: false, reason: 'NOT_FOUND' }
        // Already so: the same answer, and nothing recorded twice.
        if (!(await setRemindersStopped(tx, storeId, cart.id, stop ? { byUserId: actor.id, note: text, at } : null))) return { ok: true, value: true }
        // The note is the team's free text, kept on the cart and never in the log (LOGGING §4.1).
        await activity.record(tx, entry(stop ? cartsAudit.stopped : cartsAudit.resumed, cartTarget(cart.id)))
        return { ok: true, value: true }
      })
    })

  /**
   * "Send me a test": the step's email with a sample cart and a code that works at no checkout, to the person's own
   * address only (decided here, #321: a test never reaches an address typed in), counting in nothing.
   */
  const sendTest = (position: number) =>
    write(async (): Promise<CartsResult<true>> => {
      if (!Number.isInteger(position) || position < 1 || position > reminderSteps) return { ok: false, reason: 'INVALID_INPUT' }
      return withSystemScope(sql, async (tx): Promise<CartsResult<true>> => {
        await insertOutbox(tx, { kind: 'email', idempotencyKey: `cart-reminder-test:${crypto.randomUUID()}`, payload: { template: 'cart-reminder-test', storeId, position, to: actor.email }, partnerId: context.partnerId, storeId })
        await activity.record(tx, entry(cartsAudit.testSent, { type: 'cart_reminders', id: storeId, label: `Reminder ${position}` }))
        return { ok: true, value: true }
      })
    })

  return { list, counts, summary, detail, remindNow, sendTest, stop: (id: string, note: string | null) => setStopped(id, true, note), resume: (id: string) => setStopped(id, false, null) }
}
