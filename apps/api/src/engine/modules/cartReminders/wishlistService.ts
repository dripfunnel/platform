import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import {
  insertWishlistReminder,
  lockWishlistShopperToRemind,
  saveWishlistFlow,
  saveWishlistStep,
  selectWishlistFlow,
  setWishlistRemindersStopped,
  type WishlistStepRow,
} from '#db/scoped/wishlistReminders'
import { defaultWishlistSteps, wishlistRemindKind, wishlistSettingsSchema } from './wishlistJobs'
import { levelOf, saveNeeds, type ReminderLevel } from './rules'

// The Wishlists tab's Reminders (FIRST-RELEASE §9): the store's sequence, read by every merchant role and saved by Owner and
// Manager, and "Send reminder now", "Stop" and "Resume" for one shopper, in the caller's own store scope. The plan's
// `cart_reminders` level decides what it may do, as for carts: none sends by hand once, the first automatically, the last all three.

export const wishlistRemindersAudit = { saved: 'wishlist_reminders.saved', sent: 'wishlist.reminder_sent', stopped: 'wishlist.reminders_stopped', resumed: 'wishlist.reminders_resumed' } as const

export interface WishlistStepView {
  position: number
  enabled: boolean
  delayMinutes: number
  subject: string
  body: string
}

export interface WishlistSettingsView {
  enabled: boolean
  skipOutOfStock: boolean
  quietHours: boolean
  weeklyCap: boolean
  steps: WishlistStepView[]
  /** Null until the store saves its own: the next save names no revision. */
  revision: number | null
  /** What the plan lets the store send, so the tab can lock what it can't (the server refuses it too). */
  level: ReminderLevel
}

export type WishlistRemindersRefusal = 'INVALID_INPUT' | 'READ_ONLY' | 'STALE_REVISION' | 'NOT_FOUND' | 'CANT_REMIND'
export type WishlistRemindersResult<T> = { ok: true; value: T } | { ok: false; reason: WishlistRemindersRefusal } | { ok: false; reason: 'PLAN_LIMIT'; needs: number }

export interface WishlistRemindersDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  /** The store's `cart_reminders` index on its plan (saas/entitlements). */
  level: () => Promise<number>
  now: () => Date
}

export const maxWishlistStopNote = 200

const stepView = (s: WishlistStepRow): WishlistStepView => ({ position: s.position, enabled: s.enabled, delayMinutes: s.delay_minutes, subject: s.subject, body: s.body })

export const createWishlistRemindersService = ({ sql, context, actor, activity, facts, level, now }: WishlistRemindersDeps) => {
  const { storeId } = context
  const supplier = context.sellerScope.kind === 'seller'
  const readOnly = context.caller.kind === 'support' && context.caller.access === 'read'

  const entry = (action: string, target: { type: string; id: string; label: string }, customerId: string | null, changes: ActivityEntry['changes'] = []): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    ...(customerId ? { customerId } : {}),
    target,
    reason: null,
    changes,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const settings = async (): Promise<WishlistSettingsView | null> => {
    if (supplier) return null
    const [{ flow, steps }, index] = await Promise.all([withScope(sql, context, (tx) => selectWishlistFlow(tx, storeId)), level()])
    const saved = new Map(steps.map((s) => [s.position, stepView(s)]))
    return {
      enabled: flow?.enabled ?? false,
      skipOutOfStock: flow?.skip_out_of_stock ?? true,
      quietHours: flow?.quiet_hours ?? true,
      weeklyCap: flow?.weekly_cap ?? true,
      steps: defaultWishlistSteps.map((d) => saved.get(d.position) ?? d),
      revision: flow?.revision ?? null,
      level: levelOf(index),
    }
  }

  /** Saves the whole sequence at the revision it was read at; a save may keep what the store has, never add what its plan doesn't allow. */
  const save = async (input: unknown, revision: number | null): Promise<WishlistRemindersResult<number>> => {
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    const parsed = wishlistSettingsSchema.safeParse(input)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const s = parsed.data
    const current = await settings()
    if (!current) return { ok: false, reason: 'NOT_FOUND' }
    if (current.revision !== revision) return { ok: false, reason: 'STALE_REVISION' }
    const index = await level()
    const needs = saveNeeds(index, s, current, (x) => x.position > 1 && x.enabled, (was, step) => was.enabled === step.enabled)
    if (needs !== null) return { ok: false, reason: 'PLAN_LIMIT', needs }
    const result = await withScope(sql, context, async (tx) => {
      const written = await saveWishlistFlow(tx, storeId, { enabled: s.enabled, skipOutOfStock: s.skipOutOfStock, quietHours: s.quietHours, weeklyCap: s.weeklyCap }, revision, now())
      if (!written) return 'STALE_REVISION' as const
      for (const step of s.steps) await saveWishlistStep(tx, storeId, step)
      const changed = (['enabled', 'skipOutOfStock', 'quietHours', 'weeklyCap'] as const).filter((k) => current[k] !== s[k]).map((field) => ({ field, before: current[field], after: s[field] }))
      await activity.record(tx, entry(wishlistRemindersAudit.saved, { type: 'wishlist_reminders', id: storeId, label: 'Wishlist reminders' }, null, changed))
      return (await selectWishlistFlow(tx, storeId)).flow?.revision ?? 1
    })
    return typeof result === 'number' ? { ok: true, value: result } : { ok: false, reason: result }
  }

  const write = async <T>(work: () => Promise<WishlistRemindersResult<T>>): Promise<WishlistRemindersResult<T>> => {
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    return work()
  }
  const target = (customerId: string) => ({ type: 'wishlist', id: customerId, label: 'Wishlist' })

  /** "Send reminder now": by email at once, even in quiet hours. Below the plan's every reminder a shopper gets one. */
  const remindNow = (customerId: string) =>
    write(async (): Promise<WishlistRemindersResult<string>> => {
      if (!isUuid(customerId)) return { ok: false, reason: 'INVALID_INPUT' }
      const index = await level()
      return withSystemScope(sql, async (tx): Promise<WishlistRemindersResult<string>> => {
        const at = now()
        const who = await lockWishlistShopperToRemind(tx, storeId, customerId.toLowerCase())
        if (!who) return { ok: false, reason: 'NOT_FOUND' }
        if (who.stopped || who.contact === null || who.items === 0 || who.saved_at === null) return { ok: false, reason: 'CANT_REMIND' }
        if (index < 2 && who.queued > 0) return { ok: false, reason: 'PLAN_LIMIT', needs: 2 }
        const id = await insertWishlistReminder(tx, { storeId, customerId: customerId.toLowerCase(), stepId: null, byUserId: actor.id, savedAt: who.saved_at, now: at })
        if (!id) throw new Error('wishlist reminder: a reminder by hand was not inserted')
        await insertOutbox(tx, { kind: wishlistRemindKind, idempotencyKey: id, payload: { reminderId: id }, partnerId: who.partner_id, storeId })
        await activity.record(tx, entry(wishlistRemindersAudit.sent, target(customerId), customerId.toLowerCase()))
        return { ok: true, value: id }
      })
    })

  /** "Stop reminders" for this shopper, with the team's note; "Resume" picks the schedule up again. */
  const setStopped = (customerId: string, stop: boolean, note: string | null) =>
    write(async (): Promise<WishlistRemindersResult<true>> => {
      const text = note?.trim() || null
      if (!isUuid(customerId) || (text?.length ?? 0) > maxWishlistStopNote) return { ok: false, reason: 'INVALID_INPUT' }
      return withSystemScope(sql, async (tx): Promise<WishlistRemindersResult<true>> => {
        const at = now()
        const who = await lockWishlistShopperToRemind(tx, storeId, customerId.toLowerCase())
        if (!who) return { ok: false, reason: 'NOT_FOUND' }
        // Already so: the same answer, and nothing recorded twice.
        if (!(await setWishlistRemindersStopped(tx, storeId, customerId.toLowerCase(), stop ? { byUserId: actor.id, note: text, at } : null))) return { ok: true, value: true }
        // The note is the team's free text, kept on the customer and never in the log (LOGGING §4.1).
        await activity.record(tx, entry(stop ? wishlistRemindersAudit.stopped : wishlistRemindersAudit.resumed, target(customerId), customerId.toLowerCase()))
        return { ok: true, value: true }
      })
    })

  return { settings, save, remindNow, stop: (id: string, note: string | null) => setStopped(id, true, note), resume: (id: string) => setStopped(id, false, null) }
}
