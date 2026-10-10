import type postgres from 'postgres'
import {
  insertReminder,
  lockReminderToDecide,
  markAbandoned,
  markRecovered,
  remindedAboutAnotherCart,
  selectDueSteps,
  selectIdleCarts,
  selectReminderConsent,
  setReminderChannel,
  skipReminder,
  switchReminderToEmail,
  type ReminderChannel,
  type ReminderToDecideRow,
  type SkipReason,
} from '#db/scoped/cartReminders'
import { suppressedAmong } from '#db/scoped/emailSuppression'
import { withSystemScope, type ScopedSql } from '#db/scoped/index'
import { insertOutbox } from '#db/scoped/outbox'
import { cartLinesNow, type CartLineNow } from '#engine/modules/cart/index'
import { issueReminderCode, localTimeIn } from '#engine/modules/promotions/index'
import { idleMs, mayEmail, quietWaitMs, reminderWindowMs, skipReasonOf, weeklyCapMs } from './rules'

// The engine's side of abandoned carts (FIRST-RELEASE §9), run from the cron and the outbox in system scope: a cart left in
// checkout is marked, each step that falls due is queued once, and each queued reminder is decided when it is delivered.

/** The outbox kind that decides one queued reminder (jobs/queues/deliverers/cartRemind.ts). */
export const cartRemindKind = 'cart.remind'

export interface ReminderJobDeps {
  sql: postgres.Sql
  now: () => Date
}

export interface DecideDeps extends ReminderJobDeps {
  /** EMAIL_SUPPRESSION_KEY: an address that bounced or complained is never reminded. */
  suppressionKey: string
  /** Whether the partner's WhatsApp account can send this message now; absent, every reminder goes by email. */
  whatsappReady?: (tx: ScopedSql, partnerId: string, message: 'cart.reminder' | 'cart.reminder_code') => Promise<boolean>
}

const linesOf = (sql: postgres.Sql, now: () => Date, c: { storeId: string; partnerId: string; language: string; currency: string; marketId: string | null; features: Record<string, boolean> }, lines: { version_id: string; quantity: number }[]) =>
  lines.length === 0 ? Promise.resolve([]) : cartLinesNow({ sql, storeId: c.storeId, partnerId: c.partnerId, language: c.language, currency: c.currency, marketId: c.marketId, features: c.features, now }, lines)

const subtotalOf = (lines: readonly CartLineNow[]): bigint | null => {
  const priced = lines.filter((l) => l.lineTotal !== null)
  return priced.length === 0 ? null : priced.reduce((sum, l) => sum + (l.lineTotal?.amount ?? 0n), 0n)
}

/** Marks up to `limit` carts left in checkout, each with what it came to then; how many it marked. */
export const markAbandonedCarts = async ({ sql, now }: ReminderJobDeps, limit: number): Promise<number> => {
  const at = now()
  const carts = await withSystemScope(sql, (tx) => selectIdleCarts(tx, at, idleMs, reminderWindowMs, limit))
  let marked = 0
  for (const cart of carts) {
    const lines = await linesOf(sql, now, { storeId: cart.store_id, partnerId: cart.partner_id, language: cart.language, currency: cart.currency, marketId: cart.market_id, features: cart.features }, cart.lines)
    if (await withSystemScope(sql, (tx) => markAbandoned(tx, cart.id, cart.stamp, subtotalOf(lines)))) marked += 1
  }
  return marked
}

/** Queues each cart's step now due, once whichever sweep finds it (the step's unique row); how many it queued. */
export const queueDueReminders = async ({ sql, now }: ReminderJobDeps, limit: number): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    const at = now()
    let queued = 0
    for (const due of await selectDueSteps(tx, at, reminderWindowMs, limit)) {
      const id = await insertReminder(tx, { storeId: due.store_id, orderId: due.order_id, stepId: due.step_id, byUserId: null, now: at })
      if (!id) continue
      await insertOutbox(tx, { kind: cartRemindKind, idempotencyKey: id, payload: { reminderId: id }, partnerId: due.partner_id, storeId: due.store_id })
      queued += 1
    }
    return queued
  })

export type ReminderDecision = { kind: 'done' } | { kind: 'skipped'; reason: string } | { kind: 'queued'; channel: ReminderChannel } | { kind: 'wait'; ms: number }

/** The words a reminder's code offer goes by on the shopper's receipt (OFFERS fact 13). */
const codeOfferName = (percent: number) => `${percent}% off your cart`

/**
 * Decides one queued reminder as it is delivered: skipped with its reason, held through quiet hours, or handed to its
 * channel with its code. The reminder's row is locked, so a second delivery of the same row finds it decided.
 */
export const decideReminder = async ({ sql, now, suppressionKey, whatsappReady }: DecideDeps, reminderId: string, tenant: { partnerId: string | null; storeId: string | null }): Promise<ReminderDecision> => {
  const peek = await withSystemScope(sql, (tx) => lockReminderToDecide(tx, reminderId, now()))
  // A row filed under another store or partner is someone else's: nobody is reminded (as order.notify refuses one).
  if (!peek || peek.state !== 'queued' || peek.store_id !== tenant.storeId || peek.partner_id !== tenant.partnerId) return { kind: 'done' }
  const c = peek.cart
  const lines = await linesOf(sql, now, { storeId: peek.store_id, partnerId: peek.partner_id, language: c.language, currency: c.currency, marketId: c.market_id, features: c.features }, c.lines)
  return withSystemScope(sql, async (tx): Promise<ReminderDecision> => {
    const at = now()
    const r = await lockReminderToDecide(tx, reminderId, at)
    if (!r || r.state !== 'queued') return { kind: 'done' }
    const consent = await selectReminderConsent(tx, r.store_id, r.cart.customer_id, r.cart.email)
    const weeklyCap = r.flow?.weekly_cap ?? true
    // One sent by hand takes the percentage its sender chose; a step its own. Either needs every reminder (level 2).
    const bps = r.by_hand ? r.discount_bps : (r.step?.discount_bps ?? null)
    const percent = bps && r.level >= 2 ? bps / 100 : null
    // WhatsApp in India, to a signed-in shopper's own number who agreed to it (#337; Carts "WhatsApp needs opt-in"),
    // through the partner's account; anyone else gets the email.
    const number = r.cart.customer_id !== null && consent?.consent_state === 'opted_in' && consent.consent_channels.includes('whatsapp') && consent.phone?.startsWith('+91') ? consent.phone : null
    const wantsWhatsApp = !r.by_hand && r.step?.channel === 'whatsapp' && r.level >= 2 && r.store_country === 'IN' && number !== null
    const channel: ReminderChannel = wantsWhatsApp && whatsappReady && (await whatsappReady(tx, r.partner_id, percent ? 'cart.reminder_code' : 'cart.reminder')) ? 'whatsapp' : 'email'
    const email = channel === 'email' ? r.cart.email : null
    const reason = skipReasonOf({
      byHand: r.by_hand,
      storeSending: r.store_status === 'trial' || r.store_status === 'active',
      flowEnabled: r.flow?.enabled ?? false,
      levelAllows: r.level >= ((r.step?.position ?? 1) === 1 ? 1 : 2),
      stepEnabled: r.step?.enabled ?? false,
      cartOpen: r.cart.state === 'cart' && !r.cart.expired,
      stopped: r.cart.stopped,
      recovered: r.cart.recovered,
      contact: channel === 'whatsapp' ? number : email,
      mayContact: channel === 'whatsapp' || mayEmail(r.store_country, consent),
      suppressed: email !== null && (await suppressedAmong(tx, suppressionKey, [email])).size > 0,
      skipOutOfStock: r.flow?.skip_out_of_stock ?? true,
      allOutOfStock: lines.length > 0 && lines.every((l) => l.outOfStock),
      underMinimum: underMinimum(r),
      weeklyCap,
      remindedAnotherCart: weeklyCap && !r.by_hand ? await remindedAboutAnotherCart(tx, r.store_id, r.cart.id, r.cart.customer_id, r.cart.email, new Date(at.getTime() - weeklyCapMs)) : false,
    })
    if (reason) {
      await skipReminder(tx, r.id, reason)
      return { kind: 'skipped', reason }
    }
    // "Remind now" goes at once, even in quiet hours (Carts); an automatic one waits for 8 am in the store's time.
    const wait = !r.by_hand && (r.flow?.quiet_hours ?? true) ? quietWaitMs(localTimeIn(at, r.time_zone).minutes) : 0
    if (wait > 0) return { kind: 'wait', ms: wait }
    const code = percent ? await issueReminderCode(tx, { storeId: r.store_id, percent, name: codeOfferName(percent), orderId: r.cart.id, customerId: r.cart.customer_id, now: at }) : null
    await setReminderChannel(tx, r.id, channel, code?.id ?? null)
    // Only what can be bought now goes in it: a line gone out of stock is left out (Carts).
    const shown = lines.filter((l) => !l.outOfStock && l.name !== null).map((l) => ({ name: l.versionName ? `${l.name}, ${l.versionName}` : (l.name ?? ''), quantity: l.quantity, amount: l.lineTotal?.amount.toString() ?? null }))
    const message = { reminderId: r.id, currency: r.cart.currency, lines: shown }
    // A WhatsApp row carries its email too, which it falls back to if it can't go after all (deliverers/whatsapp.ts).
    if (channel === 'whatsapp') await insertOutbox(tx, { kind: 'whatsapp', idempotencyKey: `cart-reminder:${r.id}`, payload: { ...message }, partnerId: r.partner_id, storeId: r.store_id })
    else await insertOutbox(tx, { kind: 'email', idempotencyKey: `cart-reminder:${r.id}`, payload: { template: 'cart-reminder', ...message }, partnerId: r.partner_id, storeId: r.store_id })
    return { kind: 'queued', channel }
  })
}

/**
 * A WhatsApp reminder that can't go after all (its account, template or number gone by delivery) becomes the email its
 * row carries, under the email's own rules: the shopper's answer for email and the suppression list, checked now.
 */
export const fallBackToEmail = async (
  tx: ScopedSql,
  message: { reminderId: string; currency: string; lines: readonly { name: string; quantity: number; amount: string | null }[] },
  suppressionKey: string,
  now: Date,
): Promise<'email' | SkipReason | null> => {
  const r = await lockReminderToDecide(tx, message.reminderId, now)
  if (!r || r.state !== 'queued') return null
  const email = r.cart.email
  const consent = await selectReminderConsent(tx, r.store_id, r.cart.customer_id, email)
  const reason: SkipReason | null = !email ? 'no_contact' : !mayEmail(r.store_country, consent) ? 'opted_out' : (await suppressedAmong(tx, suppressionKey, [email])).size > 0 ? 'undeliverable' : null
  if (reason) {
    await skipReminder(tx, r.id, reason)
    return reason
  }
  if (!(await switchReminderToEmail(tx, r.id))) return null
  await insertOutbox(tx, { kind: 'email', idempotencyKey: `cart-reminder:${r.id}`, payload: { template: 'cart-reminder', ...message }, partnerId: r.partner_id, storeId: r.store_id })
  return 'email'
}

/** A live order placed: the carts its shopper left in the last week are recovered by it, which stops their reminders. */
export const recoverCarts = (tx: ScopedSql, r: { storeId: string; orderId: string; customerId: string | null; email: string | null; now: Date }): Promise<number> =>
  markRecovered(tx, { ...r, windowMs: reminderWindowMs })

/** Under the store's minimum, in the minimum's own currency; a cart in another currency isn't held by it. */
const underMinimum = (r: ReminderToDecideRow): boolean => {
  const min = r.flow?.min_amount
  if (!min || r.flow?.currency !== r.cart.currency) return false
  return r.cart.abandoned_amount !== null && BigInt(r.cart.abandoned_amount) < BigInt(min)
}
