import type { ScopedSql } from './index'
import { reminderLevelSql } from './cartReminders'

// Wishlist reminders (migration 0385; FIRST-RELEASE §9): the settings the merchant side writes, and the reminders the engine
// queues, decides and sends in system scope. They follow the carts' (db/scoped/cartReminders.ts) with the shopper in place of
// the cart, and email only.

export type WishlistSkipReason = 'stopped' | 'paused' | 'no_contact' | 'opted_out' | 'undeliverable' | 'out_of_stock' | 'weekly_cap' | 'empty' | 'no_shop_host'

export interface WishlistFlowRow {
  enabled: boolean
  skip_out_of_stock: boolean
  quiet_hours: boolean
  weekly_cap: boolean
  revision: number
}

export interface WishlistStepRow {
  id: string
  position: number
  enabled: boolean
  delay_minutes: number
  subject: string
  body: string
}

export const selectWishlistFlow = async (tx: ScopedSql, storeId: string): Promise<{ flow: WishlistFlowRow | null; steps: WishlistStepRow[] }> => {
  const [flow] = await tx<WishlistFlowRow[]>`select enabled, skip_out_of_stock, quiet_hours, weekly_cap, revision from wishlist_reminder_flow where store_id = ${storeId}`
  const steps = await tx<WishlistStepRow[]>`select id, position, enabled, delay_minutes, subject, body from wishlist_reminder_step where store_id = ${storeId} order by position`
  return { flow: flow ?? null, steps }
}

export interface WishlistFlowWrite {
  enabled: boolean
  skipOutOfStock: boolean
  quietHours: boolean
  weeklyCap: boolean
}

/** The flow at the revision it was read at (null: none saved yet); false when someone saved since. */
export const saveWishlistFlow = async (tx: ScopedSql, storeId: string, f: WishlistFlowWrite, revision: number | null, now: Date): Promise<boolean> => {
  if (revision === null) {
    const rows = await tx`
      insert into wishlist_reminder_flow (store_id, enabled, skip_out_of_stock, quiet_hours, weekly_cap) values (${storeId}, ${f.enabled}, ${f.skipOutOfStock}, ${f.quietHours}, ${f.weeklyCap})
      on conflict (store_id) do nothing
    `
    return rows.count > 0
  }
  const rows = await tx`
    update wishlist_reminder_flow set enabled = ${f.enabled}, skip_out_of_stock = ${f.skipOutOfStock}, quiet_hours = ${f.quietHours}, weekly_cap = ${f.weeklyCap}, updated_at = ${now}, revision = revision + 1
    where store_id = ${storeId} and revision = ${revision}
  `
  return rows.count > 0
}

export interface WishlistStepWrite {
  position: number
  enabled: boolean
  delayMinutes: number
  subject: string
  body: string
}

/** In place by position, so a sent reminder still names the step it came from. */
export const saveWishlistStep = async (tx: ScopedSql, storeId: string, s: WishlistStepWrite): Promise<void> => {
  await tx`
    insert into wishlist_reminder_step (store_id, position, enabled, delay_minutes, subject, body) values (${storeId}, ${s.position}, ${s.enabled}, ${s.delayMinutes}, ${s.subject}, ${s.body})
    on conflict (store_id, position) do update set enabled = excluded.enabled, delay_minutes = excluded.delay_minutes, subject = excluded.subject, body = excluded.body
  `
}

export interface DueWishlistRow {
  store_id: string
  partner_id: string
  customer_id: string
  step_id: string
  saved_at: Date
}

/**
 * Each shopper's latest step now due and not yet queued, of stores sending automatically: a wishlist changed within `windowMs`
 * and untouched for the step's delay, its shopper neither erased nor stopped. A step after the first needs the plan's every reminder.
 */
export const selectDueWishlistSteps = (tx: ScopedSql, now: Date, windowMs: number, limit: number): Promise<DueWishlistRow[]> =>
  tx<DueWishlistRow[]>`
    with lists as (
      select w.store_id, w.customer_id, date_trunc('milliseconds', max(w.created_at)) as saved_at
      from wishlist_item w join wishlist_reminder_flow f on f.store_id = w.store_id and f.enabled
      group by w.store_id, w.customer_id having max(w.created_at) > ${new Date(now.getTime() - windowMs)}
    ), due as (
      select l.store_id, s.partner_id, l.customer_id, st.id as step_id, l.saved_at, l.saved_at + make_interval(mins => st.delay_minutes) as due_at,
        row_number() over (partition by l.customer_id order by st.position desc) as latest
      from lists l
      join store s on s.id = l.store_id and s.status in ('trial', 'active')
      join wishlist_reminder_flow f on f.store_id = l.store_id and f.enabled
      join wishlist_reminder_step st on st.store_id = l.store_id and st.enabled
      join customer c on c.id = l.customer_id and c.store_id = l.store_id and c.status <> 'deleted' and c.wishlist_reminders_stopped_at is null
      cross join lateral (select ${reminderLevelSql(tx, tx`l.store_id`, now)} as level) lv
      where l.saved_at > ${new Date(now.getTime() - windowMs)} and l.saved_at + make_interval(mins => st.delay_minutes) <= ${now}
        and lv.level >= case when st.position = 1 then 1 else 2 end
        and not exists (select 1 from wishlist_reminder r join wishlist_reminder_step rs on rs.id = r.step_id where r.customer_id = l.customer_id and r.saved_at = l.saved_at and rs.position >= st.position)
    )
    select store_id, partner_id, customer_id, step_id, saved_at from due where latest = 1 order by due_at limit ${limit}
  `

/** A reminder to send, by its step or by hand; null when that step was queued already for this state of the list. */
export const insertWishlistReminder = async (tx: ScopedSql, r: { storeId: string; customerId: string; stepId: string | null; byUserId: string | null; savedAt: Date; now: Date }): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      insert into wishlist_reminder (store_id, customer_id, step_id, sent_by_user_id, saved_at, queued_at) values (${r.storeId}, ${r.customerId}, ${r.stepId}, ${r.byUserId}, ${r.savedAt}, ${r.now})
      on conflict (customer_id, step_id, saved_at) where step_id is not null do nothing
      returning id
    `
  )[0]?.id ?? null

export interface WishlistReminderToDecideRow {
  id: string
  store_id: string
  partner_id: string
  state: 'queued' | 'sent' | 'skipped'
  by_hand: boolean
  step: Pick<WishlistStepRow, 'position' | 'enabled'> | null
  store_status: string
  store_country: string | null
  time_zone: string
  language: string
  currency: string
  level: number
  flow: Pick<WishlistFlowRow, 'enabled' | 'skip_out_of_stock' | 'quiet_hours' | 'weekly_cap'> | null
  customer_id: string
  email: string | null
  stopped: boolean
  features: Record<string, boolean>
  product_ids: string[]
}

/** The reminder with everything its decision reads, its row held until the transaction ends so one sweep decides it. */
export const lockWishlistReminderToDecide = async (tx: ScopedSql, id: string, now: Date): Promise<WishlistReminderToDecideRow | null> => {
  const [locked] = await tx<{ id: string }[]>`select id from wishlist_reminder where id = ${id} for update`
  if (!locked) return null
  const [row] = await tx<WishlistReminderToDecideRow[]>`
    select r.id, r.store_id, s.partner_id, r.state, r.step_id is null as by_hand, s.status as store_status, s.country as store_country, s.time_zone,
      s.main_language as language, s.pricing_currency as currency, ${reminderLevelSql(tx, tx`r.store_id`, now)}::int as level,
      (select json_build_object('position', st.position, 'enabled', st.enabled) from wishlist_reminder_step st
        where st.store_id = r.store_id and (st.id = r.step_id or (r.step_id is null and st.position = 1))) as step,
      (select json_build_object('enabled', f.enabled, 'skip_out_of_stock', f.skip_out_of_stock, 'quiet_hours', f.quiet_hours, 'weekly_cap', f.weekly_cap)
        from wishlist_reminder_flow f where f.store_id = r.store_id) as flow,
      c.id as customer_id, c.email, c.wishlist_reminders_stopped_at is not null as stopped,
      coalesce((select json_object_agg(sf.key, sf.enabled) from store_feature sf where sf.store_id = s.id), '{}'::json) as features,
      coalesce((select json_agg(x.product_id) from (select w.product_id from wishlist_item w where w.store_id = r.store_id and w.customer_id = r.customer_id order by w.created_at desc, w.product_id limit 100) x), '[]'::json) as product_ids
    from wishlist_reminder r join store s on s.id = r.store_id join customer c on c.id = r.customer_id and c.store_id = r.store_id
    where r.id = ${id}
  `
  return row ?? null
}

/** Whether this shopper had a wishlist reminder sent since `since`. */
export const remindedAboutWishlistSince = async (tx: ScopedSql, storeId: string, customerId: string, id: string, since: Date): Promise<boolean> =>
  (await tx`select 1 from wishlist_reminder where store_id = ${storeId} and customer_id = ${customerId} and id <> ${id} and state = 'sent' and sent_at > ${since} limit 1`).length > 0

export const skipWishlistReminder = async (tx: ScopedSql, id: string, reason: WishlistSkipReason): Promise<void> => {
  await tx`update wishlist_reminder set state = 'skipped', skip_reason = ${reason} where id = ${id} and state = 'queued'`
}

export interface WishlistReminderToSendRow {
  store_id: string
  partner_id: string
  store_name: string
  contact_email: string | null
  address: Record<string, string | undefined>
  locale: string
  store_country: string | null
  state: 'queued' | 'sent' | 'skipped'
  to: string | null
  name: string | null
  subject: string | null
  body: string | null
  consent: { consent_state: string; consent_channels: string[] } | null
}

export const selectWishlistReminderToSend = async (tx: ScopedSql, id: string): Promise<WishlistReminderToSendRow | null> =>
  (
    await tx<WishlistReminderToSendRow[]>`
      select r.store_id, s.partner_id, s.name as store_name, s.contact_email, s.address, s.main_language as locale, s.country as store_country, r.state,
        c.email as to, c.name, st.subject, st.body,
        json_build_object('consent_state', c.consent_state, 'consent_channels', c.consent_channels) as consent
      from wishlist_reminder r join store s on s.id = r.store_id join customer c on c.id = r.customer_id and c.store_id = r.store_id
      left join wishlist_reminder_step st on st.store_id = r.store_id and (st.id = r.step_id or (r.step_id is null and st.position = 1))
      where r.id = ${id}
    `
  )[0] ?? null

/** Marks it sent with the unsubscribe link's hashed token; false when it was decided otherwise since. */
export const markWishlistReminderSent = async (tx: ScopedSql, id: string, tokenHash: string, now: Date): Promise<boolean> =>
  (await tx`update wishlist_reminder set state = 'sent', link_token_hash = ${tokenHash}, sent_at = ${now} where id = ${id} and state = 'queued'`).count > 0

export interface WishlistReminderLinkRow {
  customer_id: string
  email: string | null
  sent_at: Date
}

export const selectWishlistReminderByToken = async (tx: ScopedSql, storeId: string, tokenHash: string): Promise<WishlistReminderLinkRow | null> =>
  (
    await tx<WishlistReminderLinkRow[]>`
      select r.customer_id, c.email, r.sent_at from wishlist_reminder r join customer c on c.id = r.customer_id and c.store_id = r.store_id
      where r.store_id = ${storeId} and r.link_token_hash = ${tokenHash} and r.state = 'sent'
    `
  )[0] ?? null

export interface WishlistShopperToRemindRow {
  partner_id: string
  stopped: boolean
  contact: string | null
  items: number
  saved_at: Date | null
  queued: number
}

/** The shopper, held to the end of the transaction so two "Send reminder now" presses go one after the other. */
export const lockWishlistShopperToRemind = async (tx: ScopedSql, storeId: string, customerId: string): Promise<WishlistShopperToRemindRow | null> => {
  if ((await tx`select id from customer where id = ${customerId} and store_id = ${storeId} and status <> 'deleted' for update`).length === 0) return null
  return (
    await tx<WishlistShopperToRemindRow[]>`
      select s.partner_id, c.wishlist_reminders_stopped_at is not null as stopped, c.email as contact,
        (select count(*)::int from wishlist_item w where w.store_id = c.store_id and w.customer_id = c.id) as items,
        (select date_trunc('milliseconds', max(w.created_at)) from wishlist_item w where w.store_id = c.store_id and w.customer_id = c.id) as saved_at,
        (select count(*)::int from wishlist_reminder r where r.customer_id = c.id and r.state <> 'skipped'
          and r.saved_at = (select date_trunc('milliseconds', max(w.created_at)) from wishlist_item w where w.store_id = c.store_id and w.customer_id = c.id)) as queued
      from customer c join store s on s.id = c.store_id where c.id = ${customerId} and c.store_id = ${storeId}
    `
  )[0] ?? null
}

/** Stops or resumes a shopper's wishlist reminders; false when it was already so. */
export const setWishlistRemindersStopped = async (tx: ScopedSql, storeId: string, customerId: string, stop: { byUserId: string; note: string | null; at: Date } | null): Promise<boolean> =>
  (
    stop
      ? await tx`update customer set wishlist_reminders_stopped_at = ${stop.at}, wishlist_reminders_stopped_by_user_id = ${stop.byUserId}, wishlist_reminders_stopped_note = ${stop.note}
          where id = ${customerId} and store_id = ${storeId} and wishlist_reminders_stopped_at is null`
      : await tx`update customer set wishlist_reminders_stopped_at = null, wishlist_reminders_stopped_by_user_id = null, wishlist_reminders_stopped_note = null
          where id = ${customerId} and store_id = ${storeId} and wishlist_reminders_stopped_at is not null`
  ).count > 0

export interface WishlistReminderRow {
  id: string
  position: number | null
  state: 'queued' | 'sent' | 'skipped'
  skip_reason: WishlistSkipReason | null
  sent_by: string | null
  queued_at: Date
  sent_at: Date | null
}

/** A shopper's reminders, newest first. */
export const selectWishlistReminders = (tx: ScopedSql, storeId: string, customerId: string): Promise<WishlistReminderRow[]> =>
  tx<WishlistReminderRow[]>`
    select r.id, st.position, r.state, r.skip_reason, (select coalesce(u.name, u.email) from "user" u where u.id = r.sent_by_user_id) as sent_by, r.queued_at, r.sent_at
    from wishlist_reminder r left join wishlist_reminder_step st on st.id = r.step_id
    where r.store_id = ${storeId} and r.customer_id = ${customerId} order by r.queued_at desc, r.id limit 50
  `
