import type postgres from 'postgres'
import { pgArray, type ScopedSql } from './index'

// Abandoned carts and their reminders (migration 0120; DATA-MODEL §7.2, §7.6). The settings are read and written in the
// merchant's store scope; finding, reminding and the shopper's links run in system scope, each query naming its store.

export type ReminderChannel = 'email' | 'whatsapp'
export type SkipReason = 'cart_gone' | 'stopped' | 'recovered' | 'paused' | 'no_contact' | 'opted_out' | 'undeliverable' | 'out_of_stock' | 'under_minimum' | 'weekly_cap' | 'no_shop_host'

/** The plan's `cart_reminders` choice (planKeys.ts): you send, one automatic reminder, or all three. */
export const reminderLevelSql = (tx: ScopedSql, storeColumn: postgres.PendingQuery<postgres.Row[]>, now: Date) => tx`
  coalesce((
    select coalesce(
      (select ov.amount from store_limit_override ov where ov.store_id = sub.store_id and ov.key = 'cart_reminders' and ov.removed_at is null
         and (ov.duration = 'always' or ov.month = date_trunc('month', ${now}::timestamptz)::date) order by ov.created_at desc limit 1),
      e.amount)
    from store_subscription sub
    left join plan_entitlement e on e.plan_id = sub.plan_id and e.version = sub.plan_version and e.key = 'cart_reminders'
    where sub.store_id = ${storeColumn}
  ), 0)
`

export interface FlowRow {
  enabled: boolean
  min_amount: string | null
  currency: string | null
  skip_out_of_stock: boolean
  quiet_hours: boolean
  weekly_cap: boolean
  revision: number
}

export interface StepRow {
  id: string
  position: number
  enabled: boolean
  delay_minutes: number
  channel: ReminderChannel
  subject: string
  body: string
  discount_bps: number | null
}

export const selectReminderFlow = async (tx: ScopedSql, storeId: string): Promise<{ flow: FlowRow | null; steps: StepRow[] }> => {
  const [flow] = await tx<FlowRow[]>`
    select enabled, min_amount::text as min_amount, currency, skip_out_of_stock, quiet_hours, weekly_cap, revision from cart_reminder_flow where store_id = ${storeId}
  `
  const steps = await tx<StepRow[]>`
    select id, position, enabled, delay_minutes, channel, subject, body, discount_bps from cart_reminder_step where store_id = ${storeId} order by position
  `
  return { flow: flow ?? null, steps }
}

export interface FlowWrite {
  enabled: boolean
  minAmount: bigint | null
  currency: string | null
  skipOutOfStock: boolean
  quietHours: boolean
  weeklyCap: boolean
}

/** The flow at the revision it was read at (null: none saved yet); false when someone saved since. */
export const saveReminderFlow = async (tx: ScopedSql, storeId: string, f: FlowWrite, revision: number | null, now: Date): Promise<boolean> => {
  const min = f.minAmount === null ? null : f.minAmount.toString()
  if (revision === null) {
    const rows = await tx`
      insert into cart_reminder_flow (store_id, enabled, min_amount, currency, skip_out_of_stock, quiet_hours, weekly_cap)
      values (${storeId}, ${f.enabled}, ${min}, ${f.currency}, ${f.skipOutOfStock}, ${f.quietHours}, ${f.weeklyCap})
      on conflict (store_id) do nothing
    `
    return rows.count > 0
  }
  const rows = await tx`
    update cart_reminder_flow set enabled = ${f.enabled}, min_amount = ${min}, currency = ${f.currency}, skip_out_of_stock = ${f.skipOutOfStock},
      quiet_hours = ${f.quietHours}, weekly_cap = ${f.weeklyCap}, updated_at = ${now}, revision = revision + 1
    where store_id = ${storeId} and revision = ${revision}
  `
  return rows.count > 0
}

export interface StepWrite {
  position: number
  enabled: boolean
  delayMinutes: number
  channel: ReminderChannel
  subject: string
  body: string
  discountBps: number | null
}

/** In place by position, so a sent reminder still names the step it came from. */
export const saveReminderStep = async (tx: ScopedSql, storeId: string, s: StepWrite): Promise<void> => {
  await tx`
    insert into cart_reminder_step (store_id, position, enabled, delay_minutes, channel, subject, body, discount_bps)
    values (${storeId}, ${s.position}, ${s.enabled}, ${s.delayMinutes}, ${s.channel}, ${s.subject}, ${s.body}, ${s.discountBps})
    on conflict (store_id, position) do update set enabled = excluded.enabled, delay_minutes = excluded.delay_minutes, channel = excluded.channel,
      subject = excluded.subject, body = excluded.body, discount_bps = excluded.discount_bps
  `
}

/** The facts a save checks: the store's country (WhatsApp is India's) and the currencies it sells in. */
export const selectReminderStore = async (tx: ScopedSql, storeId: string): Promise<{ country: string | null; currencies: string[] } | null> =>
  (
    await tx<{ country: string | null; currencies: string[] }[]>`
      select s.country, to_json(array(select s.pricing_currency::text where s.pricing_currency is not null union select c.currency::text from store_currency c where c.store_id = s.id)) as currencies
      from store s where s.id = ${storeId}
    `
  )[0] ?? null

export interface IdleCartRow {
  id: string
  store_id: string
  partner_id: string
  store_status: string
  currency: string
  language: string
  market_id: string | null
  /** The cart's last change in microseconds, as Postgres holds it: a Date would round it to the millisecond. */
  stamp: string
  features: Record<string, boolean>
  lines: { version_id: string; quantity: number }[]
}

/**
 * Carts left in checkout at least `idleMs` ago and not marked since they last changed: a shopper who gave a contact or
 * started checkout, with something in the cart. Older than the reminders' week, a cart is never marked.
 */
export const selectIdleCarts = (tx: ScopedSql, now: Date, idleMs: number, windowMs: number, limit: number): Promise<IdleCartRow[]> =>
  tx<IdleCartRow[]>`
    select o.id, o.store_id, s.partner_id, s.status as store_status, o.currency, coalesce(o.language, s.main_language) as language, o.market_id, (extract(epoch from o.updated_at) * 1000000)::bigint::text as stamp,
      coalesce((select json_object_agg(sf.key, sf.enabled) from store_feature sf where sf.store_id = s.id), '{}'::json) as features,
      (select json_agg(json_build_object('version_id', l.version_id, 'quantity', l.quantity) order by l.added_at, l.version_id) from cart_line l where l.order_id = o.id) as lines
    from "order" o join store s on s.id = o.store_id
    where o.state = 'cart' and o.updated_at <= ${new Date(now.getTime() - idleMs)} and o.updated_at > ${new Date(now.getTime() - windowMs)}
      and (o.cart_expires_at is null or o.cart_expires_at > ${now})
      and (o.abandoned_at is null or o.abandoned_at < o.updated_at)
      and (o.checkout_step is not null or o.email is not null or o.phone is not null)
      and exists (select 1 from cart_line l where l.order_id = o.id)
    order by o.updated_at
    limit ${limit}
  `

/** Marked as left when it last changed; a change since (the shopper came back) leaves it to the next sweep. */
export const markAbandoned = async (tx: ScopedSql, id: string, stamp: string, amount: bigint | null): Promise<boolean> =>
  (
    await tx`
      update "order" set abandoned_at = updated_at, abandoned_amount = ${amount === null ? null : amount.toString()}
      where id = ${id} and state = 'cart' and (extract(epoch from updated_at) * 1000000)::bigint = ${stamp}::bigint
    `
  ).count > 0

export interface DueStepRow {
  order_id: string
  store_id: string
  partner_id: string
  step_id: string
}

/**
 * Each cart's latest step now due and not yet queued, of stores sending automatically: a cart left within `windowMs`,
 * untouched since, neither stopped nor recovered. A step after the first needs the plan's every reminder (level 2).
 */
export const selectDueSteps = (tx: ScopedSql, now: Date, windowMs: number, limit: number): Promise<DueStepRow[]> =>
  tx<DueStepRow[]>`
    with due as (
      select o.id as order_id, o.store_id, s.partner_id, st.id as step_id, o.abandoned_at + make_interval(mins => st.delay_minutes) as due_at,
        row_number() over (partition by o.id order by st.position desc) as latest
      from "order" o
      join store s on s.id = o.store_id and s.status in ('trial', 'active')
      join cart_reminder_flow f on f.store_id = o.store_id and f.enabled
      join cart_reminder_step st on st.store_id = o.store_id and st.enabled
      cross join lateral (select ${reminderLevelSql(tx, tx`o.store_id`, now)} as level) lv
      where o.state = 'cart' and o.abandoned_at is not null and o.abandoned_at > ${new Date(now.getTime() - windowMs)} and o.updated_at <= o.abandoned_at
        and (o.cart_expires_at is null or o.cart_expires_at > ${now}) and o.reminders_stopped_at is null and o.recovered_by_order_id is null
        and o.abandoned_at + make_interval(mins => st.delay_minutes) <= ${now}
        and lv.level >= case when st.position = 1 then 1 else 2 end
        and not exists (select 1 from cart_reminder r join cart_reminder_step rs on rs.id = r.step_id where r.order_id = o.id and rs.position >= st.position)
    )
    select order_id, store_id, partner_id, step_id from due where latest = 1 order by due_at limit ${limit}
  `

/** A reminder to send, by its step or by hand; null when that step was queued already. */
export const insertReminder = async (tx: ScopedSql, r: { storeId: string; orderId: string; stepId: string | null; byUserId: string | null; now: Date }): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      insert into cart_reminder (store_id, order_id, step_id, sent_by_user_id, queued_at) values (${r.storeId}, ${r.orderId}, ${r.stepId}, ${r.byUserId}, ${r.now})
      on conflict (order_id, step_id) where step_id is not null do nothing
      returning id
    `
  )[0]?.id ?? null

export interface ReminderToDecideRow {
  id: string
  store_id: string
  partner_id: string
  state: 'queued' | 'sent' | 'skipped'
  by_hand: boolean
  /** The percentage chosen for one sent by hand; a step's own is on the step. */
  discount_bps: number | null
  /** The step's, or for one sent by hand the first step's; null when the store saved none. */
  step: Pick<StepRow, 'position' | 'channel' | 'subject' | 'body' | 'discount_bps' | 'enabled'> | null
  store_status: string
  store_country: string | null
  time_zone: string
  level: number
  flow: Pick<FlowRow, 'enabled' | 'min_amount' | 'currency' | 'skip_out_of_stock' | 'quiet_hours' | 'weekly_cap'> | null
  cart: {
    id: string
    state: string
    expired: boolean
    customer_id: string | null
    email: string | null
    phone: string | null
    currency: string
    language: string
    market_id: string | null
    abandoned_amount: string | null
    stopped: boolean
    recovered: boolean
    features: Record<string, boolean>
    lines: { version_id: string; quantity: number }[]
  }
}

/** The reminder with everything its decision reads, its row held until the transaction ends so one sweep decides it. */
export const lockReminderToDecide = async (tx: ScopedSql, id: string, now: Date): Promise<ReminderToDecideRow | null> => {
  const [locked] = await tx<{ id: string }[]>`select id from cart_reminder where id = ${id} for update`
  if (!locked) return null
  const [row] = await tx<ReminderToDecideRow[]>`
    select r.id, r.store_id, s.partner_id, r.state, r.step_id is null as by_hand, r.discount_bps, s.status as store_status, s.country as store_country, s.time_zone,
      ${reminderLevelSql(tx, tx`r.store_id`, now)}::int as level,
      (select json_build_object('position', st.position, 'channel', st.channel, 'subject', st.subject, 'body', st.body, 'discount_bps', st.discount_bps, 'enabled', st.enabled)
        from cart_reminder_step st where st.store_id = r.store_id and (st.id = r.step_id or (r.step_id is null and st.position = 1))) as step,
      (select json_build_object('enabled', f.enabled, 'min_amount', f.min_amount::text, 'currency', f.currency, 'skip_out_of_stock', f.skip_out_of_stock,
        'quiet_hours', f.quiet_hours, 'weekly_cap', f.weekly_cap) from cart_reminder_flow f where f.store_id = r.store_id) as flow,
      json_build_object('id', o.id, 'state', o.state, 'expired', coalesce(o.cart_expires_at <= ${now}, false), 'customer_id', o.customer_id,
        'email', coalesce(o.email, c.email), 'phone', coalesce(o.phone, c.phone), 'currency', o.currency, 'language', coalesce(o.language, s.main_language),
        'market_id', o.market_id, 'abandoned_amount', o.abandoned_amount::text, 'stopped', o.reminders_stopped_at is not null,
        'recovered', o.recovered_by_order_id is not null,
        'features', coalesce((select json_object_agg(sf.key, sf.enabled) from store_feature sf where sf.store_id = s.id), '{}'::json),
        'lines', coalesce((select json_agg(json_build_object('version_id', l.version_id, 'quantity', l.quantity) order by l.added_at, l.version_id)
          from cart_line l where l.order_id = o.id), '[]'::json)) as cart
    from cart_reminder r join "order" o on o.id = r.order_id and o.store_id = r.store_id join store s on s.id = r.store_id
    left join customer c on c.id = o.customer_id and c.store_id = o.store_id
    where r.id = ${id}
  `
  return row ?? null
}

/** What the shopper said about marketing: their account's, or for a guest the customer row their email is. */
export const selectReminderConsent = async (tx: ScopedSql, storeId: string, customerId: string | null, email: string | null): Promise<{ consent_state: string; consent_channels: string[]; phone: string | null } | null> =>
  (
    await tx<{ consent_state: string; consent_channels: string[]; phone: string | null }[]>`
      select consent_state, to_json(consent_channels) as consent_channels, phone from customer
      where store_id = ${storeId} and (id = ${customerId}::uuid or (${customerId}::uuid is null and ${email}::text is not null and lower(email) = lower(${email})))
      order by (id = ${customerId}::uuid) desc nulls last limit 1
    `
  )[0] ?? null

/** Whether this shopper had a reminder about another cart since `since`: their account's carts, or carts with their email. */
export const remindedAboutAnotherCart = async (tx: ScopedSql, storeId: string, orderId: string, customerId: string | null, email: string | null, since: Date): Promise<boolean> =>
  (
    await tx`
      select 1 from cart_reminder r join "order" o on o.id = r.order_id
      where r.store_id = ${storeId} and r.order_id <> ${orderId} and r.state = 'sent' and r.sent_at > ${since}
        and ((${customerId}::uuid is not null and o.customer_id = ${customerId}::uuid) or (${email}::text is not null and lower(o.email) = lower(${email})))
      limit 1
    `
  ).length > 0

export const skipReminder = async (tx: ScopedSql, id: string, reason: SkipReason): Promise<void> => {
  await tx`update cart_reminder set state = 'skipped', skip_reason = ${reason} where id = ${id} and state = 'queued'`
}

export const setReminderChannel = async (tx: ScopedSql, id: string, channel: ReminderChannel, codeId: string | null): Promise<void> => {
  await tx`update cart_reminder set channel = ${channel}, promotion_code_id = ${codeId} where id = ${id} and state = 'queued'`
}

export interface ReminderToSendRow {
  store_id: string
  partner_id: string
  store_name: string
  store_code: string
  contact_email: string | null
  address: Record<string, string>
  locale: string
  state: string
  channel: string | null
  to: string | null
  /** The signed-in shopper's own number, the one WhatsApp goes to (never a number typed in the cart). */
  phone: string | null
  items: number
  name: string | null
  subject: string | null
  body: string | null
  code: string | null
  code_percent: number | null
  code_expires_at: Date | null
}

/** What a reminder says, read as it is sent. */
export const selectReminderToSend = async (tx: ScopedSql, id: string): Promise<ReminderToSendRow | null> =>
  (
    await tx<ReminderToSendRow[]>`
      select r.store_id, s.partner_id, s.name as store_name, s.code as store_code, s.contact_email, s.address, s.main_language as locale, r.state, r.channel,
        coalesce(o.email, c.email) as to, c.phone, coalesce((select sum(l.quantity)::int from cart_line l where l.order_id = o.id), 0) as items, coalesce(o.shipping_address ->> 'name', c.name) as name,
        st.subject, st.body, pc.code, (a.args ->> 'percent')::int as code_percent, pc.expires_at as code_expires_at
      from cart_reminder r join "order" o on o.id = r.order_id and o.store_id = r.store_id join store s on s.id = r.store_id
      left join customer c on c.id = o.customer_id and c.store_id = o.store_id
      left join cart_reminder_step st on st.store_id = r.store_id and (st.id = r.step_id or (r.step_id is null and st.position = 1))
      left join promotion_code pc on pc.id = r.promotion_code_id
      left join promotion_action a on a.promotion_id = pc.promotion_id and a.position = 0
      where r.id = ${id}
    `
  )[0] ?? null

/** Marks it sent with its link's hash, once: false when another delivery got there first. */
export const markReminderSent = async (tx: ScopedSql, id: string, tokenHash: string, now: Date): Promise<boolean> =>
  (await tx`update cart_reminder set state = 'sent', link_token_hash = ${tokenHash}, sent_at = ${now} where id = ${id} and state = 'queued' and channel is not null`).count > 0

/** The store's live shop host, as the partner console shows it: its live custom domain, else its code on the partner's shops wildcard. */
export const selectShopHost = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (
    await tx<{ host: string | null }[]>`
      select coalesce(
        (select c.host from custom_domain c where c.store_id = s.id and c.status = 'live' order by c.host limit 1),
        (select s.code || substr(d.host, 2) from partner_domain d where d.partner_id = s.partner_id and d.kind = 'shops' and d.status = 'live' limit 1)
      ) as host
      from store s join partner p on p.id = s.partner_id where s.id = ${storeId} and p.state <> 'closed'
    `
  )[0]?.host ?? null

export interface ReminderLinkRow {
  id: string
  order_id: string
  cart_state: string
  cart_open: boolean
  customer_id: string | null
  email: string | null
  code: string | null
  codes: string[]
  sent_at: Date
}

/** The sent reminder a link's token names in this store; null for a token unknown here. */
export const selectReminderByToken = async (tx: ScopedSql, storeId: string, tokenHash: string, now: Date): Promise<ReminderLinkRow | null> =>
  (
    await tx<ReminderLinkRow[]>`
      select r.id, r.order_id, o.state as cart_state, (o.state = 'cart' and (o.cart_expires_at is null or o.cart_expires_at > ${now})) as cart_open,
        o.customer_id, o.email, pc.code, to_json(o.promotion_codes) as codes, r.sent_at
      from cart_reminder r join "order" o on o.id = r.order_id and o.store_id = r.store_id
      left join promotion_code pc on pc.id = r.promotion_code_id and pc.used_at is null and (pc.expires_at is null or pc.expires_at > ${now})
      where r.store_id = ${storeId} and r.link_token_hash = ${tokenHash} and r.state = 'sent'
    `
  )[0] ?? null

/**
 * Back from a reminder: the click is recorded once, its code joins the cart's, and a guest's cart moves to the token handed
 * back now (the link opens it in whichever browser follows it). Changes made here never count as the shopper coming back.
 */
export const restoreFromReminder = async (tx: ScopedSql, r: { reminderId: string; orderId: string; codes: readonly string[]; tokenHash: string | null; now: Date }): Promise<void> => {
  await tx`update cart_reminder set clicked_at = coalesce(clicked_at, ${r.now}) where id = ${r.reminderId}`
  await tx`
    update "order" set promotion_codes = ${pgArray(r.codes)}::text[],
      access_token_hash = coalesce(${r.tokenHash}::text, access_token_hash), revision = revision + 1
    where id = ${r.orderId} and state = 'cart'
  `
}

/** "Unsubscribe": no more marketing to this customer row on any channel, as the store's own "asked to stop" (FIRST-RELEASE §7). */
export const recordUnsubscribed = async (tx: ScopedSql, storeId: string, customerId: string, now: Date): Promise<string | null> =>
  (
    await tx<{ before: string }[]>`
      update customer c set consent_state = 'stopped', consent_at = ${now}, consent_source = 'email', consent_channels = '{}'
      from customer prior where c.id = ${customerId} and c.store_id = ${storeId} and prior.id = c.id
      returning prior.consent_state as before
    `
  )[0]?.before ?? null

/** The customer row a reminder's shopper is: their account, else the one their email is. */
export const selectReminderCustomer = async (tx: ScopedSql, storeId: string, customerId: string | null, email: string | null): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      select id from customer where store_id = ${storeId} and (id = ${customerId}::uuid or (${customerId}::uuid is null and ${email}::text is not null and lower(email) = lower(${email})))
      order by (id = ${customerId}::uuid) desc nulls last limit 1
    `
  )[0]?.id ?? null

/**
 * A placed order recovers the carts its shopper left in the last `windowMs`: itself, and their others still open (their
 * account's, or with the email it was placed with), which stops their reminders. Credit goes to the reminder whose code
 * the order used, else the last one clicked.
 */
export const markRecovered = async (tx: ScopedSql, r: { storeId: string; orderId: string; customerId: string | null; email: string | null; now: Date; windowMs: number }): Promise<number> =>
  (
    await tx`
      update "order" c set recovered_by_order_id = ${r.orderId}, recovered_by_reminder_id = (
          select m.id from cart_reminder m
          where m.order_id = c.id and m.state = 'sent'
            and (m.clicked_at is not null or m.promotion_code_id in (select u.promotion_code_id from promotion_usage u where u.order_id = ${r.orderId}))
          order by (m.promotion_code_id in (select u.promotion_code_id from promotion_usage u where u.order_id = ${r.orderId})) desc nulls last, m.clicked_at desc nulls last
          limit 1)
      where c.store_id = ${r.storeId} and c.abandoned_at is not null and c.abandoned_at > ${new Date(r.now.getTime() - r.windowMs)} and c.recovered_by_order_id is null
        and (c.id = ${r.orderId} or (c.state = 'cart' and ((${r.customerId}::uuid is not null and c.customer_id = ${r.customerId}::uuid)
          or (${r.email}::text is not null and lower(c.email) = lower(${r.email})))))
    `
  ).count
