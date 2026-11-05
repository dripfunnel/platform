import { z } from 'zod'
import { suppressedAmong } from '#db/scoped/emailSuppression'
import { withSystemScope } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import {
  insertWishlistReminder,
  lockWishlistReminderToDecide,
  remindedAboutWishlistSince,
  selectDueWishlistSteps,
  skipWishlistReminder,
  type WishlistSkipReason,
} from '#db/scoped/wishlistReminders'
import { selectReminderConsent } from '#db/scoped/cartReminders'
import { localTimeIn } from '#engine/modules/promotions/index'
import type { DecideDeps, ReminderJobDeps } from './jobs'
import { mayEmail, quietWaitMs, reminderDelays, reminderSteps, reminderWindowMs, weeklyCapMs } from './rules'
import { wishlistItemsNow } from './wishlist'

// The engine's side of wishlist reminders (FIRST-RELEASE §9), run from the cron and the outbox in system scope: each step that
// falls due for a wishlist left untouched is queued once, and each queued reminder is decided as it is delivered.

/** The outbox kind that decides one queued wishlist reminder (jobs/queues/deliverers/wishlistRemind.ts). */
export const wishlistRemindKind = 'wishlist.remind'

/** Most products the email lists. */
export const wishlistReminderItems = 10

const text = (max: number) => z.string().transform((s) => s.trim()).pipe(z.string().max(max))

export const wishlistStepSchema = z
  .object({
    position: z.number().int().min(1).max(reminderSteps),
    enabled: z.boolean(),
    delayMinutes: z.number().int().refine((d) => (reminderDelays as readonly number[]).includes(d)),
    subject: text(120),
    body: text(500),
  })
  .strict()

export const wishlistSettingsSchema = z
  .object({
    enabled: z.boolean(),
    skipOutOfStock: z.boolean(),
    quietHours: z.boolean(),
    weeklyCap: z.boolean(),
    steps: z.array(wishlistStepSchema).length(reminderSteps),
  })
  .strict()
  .superRefine((s, ctx) => {
    if (new Set(s.steps.map((x) => x.position)).size !== reminderSteps) ctx.addIssue({ code: 'custom', message: 'one of each step' })
    const on = [...s.steps].sort((a, b) => a.position - b.position).filter((x) => x.enabled)
    if (on.some((x, i) => i > 0 && x.delayMinutes <= (on[i - 1]?.delayMinutes ?? 0))) ctx.addIssue({ code: 'custom', message: 'later than the one before' })
    if (s.steps.some((x) => x.enabled && x.subject === '')) ctx.addIssue({ code: 'custom', message: 'a subject' })
  })
export type WishlistSettingsInput = z.input<typeof wishlistSettingsSchema>
export type WishlistSettingsValue = z.output<typeof wishlistSettingsSchema>

/** Where a store starts, until it saves its own: the words are the merchant's to change. */
export const defaultWishlistSteps = [
  { position: 1, enabled: true, delayMinutes: 1440, subject: 'Still thinking about these?', body: 'You saved a few things to your wishlist. They are still here.' },
  { position: 2, enabled: true, delayMinutes: 2880, subject: 'Your wishlist is waiting', body: 'Popular items sell out. Take another look at what you saved.' },
  { position: 3, enabled: false, delayMinutes: 4320, subject: 'A last look at your wishlist', body: 'Your saved items are still here if you want them.' },
] as const

export interface WishlistDecisionFacts {
  byHand: boolean
  storeSending: boolean
  flowEnabled: boolean
  levelAllows: boolean
  stepEnabled: boolean
  stopped: boolean
  contact: string | null
  mayContact: boolean
  suppressed: boolean
  empty: boolean
  skipOutOfStock: boolean
  allOutOfStock: boolean
  weeklyCap: boolean
  remindedRecently: boolean
}

/**
 * Why a wishlist reminder isn't sent, in the carts' order (stopped › no contact › opted out › undeliverable › paused › nothing
 * to show › out of stock › weekly cap), or null to send it. One sent by hand answers the first four and an empty list.
 */
export const wishlistSkipReasonOf = (f: WishlistDecisionFacts): WishlistSkipReason | null => {
  if (f.stopped) return 'stopped'
  if (f.contact === null) return 'no_contact'
  if (!f.mayContact) return 'opted_out'
  if (f.suppressed) return 'undeliverable'
  if (f.empty) return 'empty'
  if (f.byHand) return null
  if (!f.storeSending || !f.flowEnabled || !f.levelAllows || !f.stepEnabled) return 'paused'
  if (f.skipOutOfStock && f.allOutOfStock) return 'out_of_stock'
  if (f.weeklyCap && f.remindedRecently) return 'weekly_cap'
  return null
}

/** Queues each shopper's step now due, once whichever sweep finds it (the step's unique row); how many it queued. */
export const queueDueWishlistReminders = async ({ sql, now }: ReminderJobDeps, limit: number): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    const at = now()
    let queued = 0
    for (const due of await selectDueWishlistSteps(tx, at, reminderWindowMs, limit)) {
      const id = await insertWishlistReminder(tx, { storeId: due.store_id, customerId: due.customer_id, stepId: due.step_id, byUserId: null, savedAt: due.saved_at, now: at })
      if (!id) continue
      await insertOutbox(tx, { kind: wishlistRemindKind, idempotencyKey: id, payload: { reminderId: id }, partnerId: due.partner_id, storeId: due.store_id })
      queued += 1
    }
    return queued
  })

export type WishlistReminderDecision = { kind: 'done' } | { kind: 'skipped'; reason: string } | { kind: 'queued' } | { kind: 'wait'; ms: number }

/**
 * Decides one queued reminder as it is delivered: skipped with its reason, held through quiet hours, or handed on as its
 * email with what can be bought now. The reminder's row is locked, so a second delivery of the same row finds it decided.
 */
export const decideWishlistReminder = async ({ sql, now, suppressionKey }: Pick<DecideDeps, 'sql' | 'now' | 'suppressionKey'>, reminderId: string, tenant: { partnerId: string | null; storeId: string | null }): Promise<WishlistReminderDecision> => {
  const peek = await withSystemScope(sql, (tx) => lockWishlistReminderToDecide(tx, reminderId, now()))
  // A row filed under another store or partner is someone else's: nobody is reminded.
  if (!peek || peek.state !== 'queued' || peek.store_id !== tenant.storeId || peek.partner_id !== tenant.partnerId) return { kind: 'done' }
  const items = await wishlistItemsNow({ sql, now }, { storeId: peek.store_id, partnerId: peek.partner_id, language: peek.language, currency: peek.currency, marketId: null, features: peek.features }, peek.product_ids, null, false)
  return withSystemScope(sql, async (tx): Promise<WishlistReminderDecision> => {
    const at = now()
    const r = await lockWishlistReminderToDecide(tx, reminderId, at)
    if (!r || r.state !== 'queued') return { kind: 'done' }
    const consent = await selectReminderConsent(tx, r.store_id, r.customer_id, null)
    const weeklyCap = r.flow?.weekly_cap ?? true
    const reason = wishlistSkipReasonOf({
      byHand: r.by_hand,
      storeSending: r.store_status === 'trial' || r.store_status === 'active',
      flowEnabled: r.flow?.enabled ?? false,
      levelAllows: r.level >= ((r.step?.position ?? 1) === 1 ? 1 : 2),
      stepEnabled: r.step?.enabled ?? false,
      stopped: r.stopped,
      contact: r.email,
      mayContact: mayEmail(r.store_country, consent),
      suppressed: r.email !== null && (await suppressedAmong(tx, suppressionKey, [r.email])).size > 0,
      empty: items.length === 0,
      skipOutOfStock: r.flow?.skip_out_of_stock ?? true,
      allOutOfStock: items.length > 0 && items.every((i) => !i.inStock),
      weeklyCap,
      remindedRecently: weeklyCap && !r.by_hand ? await remindedAboutWishlistSince(tx, r.store_id, r.customer_id, r.id, new Date(at.getTime() - weeklyCapMs)) : false,
    })
    if (reason) {
      await skipWishlistReminder(tx, r.id, reason)
      return { kind: 'skipped', reason }
    }
    // "Send reminder now" goes at once, even in quiet hours; an automatic one waits for 8 am in the store's time.
    const wait = !r.by_hand && (r.flow?.quiet_hours ?? true) ? quietWaitMs(localTimeIn(at, r.time_zone).minutes) : 0
    if (wait > 0) return { kind: 'wait', ms: wait }
    // Only what can be bought now goes in it: a product gone out of stock is left out.
    const shown = items.filter((i) => i.inStock).slice(0, wishlistReminderItems).map((i) => ({ name: i.name, amount: i.price?.amount.toString() ?? null }))
    await insertOutbox(tx, { kind: 'email', idempotencyKey: `wishlist-reminder:${r.id}`, payload: { template: 'wishlist-reminder', reminderId: r.id, currency: r.currency, items: shown }, partnerId: r.partner_id, storeId: r.store_id })
    return { kind: 'queued' }
  })
}
