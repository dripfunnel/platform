import type { ScopedSql } from './index'

// Plan billing through Razorpay Subscriptions on the partner's own account (#1744; SAAS §7.4, DATA-MODEL §7.9).

export type GatewayMode = 'live' | 'test'

export interface BillingGatewayRow {
  id: string
  mode: GatewayMode
  key_prefix: string
  last_tested_at: Date | null
}

const gatewayColumns = `id, settings->>'mode' as mode, key_prefix, last_tested_at`

export const selectBillingGateways = (tx: ScopedSql, partnerId: string): Promise<BillingGatewayRow[]> =>
  tx<BillingGatewayRow[]>`select ${tx.unsafe(gatewayColumns)} from partner_credential where partner_id = ${partnerId} and kind = 'billing' and provider = 'razorpay' order by name`

export const selectBillingGateway = async (tx: ScopedSql, partnerId: string, mode: GatewayMode): Promise<BillingGatewayRow | null> =>
  (await tx<BillingGatewayRow[]>`select ${tx.unsafe(gatewayColumns)} from partner_credential where partner_id = ${partnerId} and kind = 'billing' and provider = 'razorpay' and settings->>'mode' = ${mode} for update`)[0] ?? null

export interface GatewayWrite {
  keyEnc: string
  keyPrefix: string
  at: Date
}

export const insertBillingGateway = async (tx: ScopedSql, input: GatewayWrite & { partnerId: string; mode: GatewayMode; createdBy: string }): Promise<void> => {
  await tx`
    insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, status, last_tested_at, created_by, created_at, updated_at)
    values (${input.partnerId}, 'billing', 'razorpay', ${`Razorpay ${input.mode}`}, ${input.keyEnc}, ${input.keyPrefix}, ${JSON.stringify({ mode: input.mode })}::text::jsonb, 'ok', ${input.at}, ${input.createdBy}, ${input.at}, ${input.at})`
}

export const updateBillingGateway = async (tx: ScopedSql, id: string, input: GatewayWrite): Promise<void> => {
  await tx`update partner_credential set key_enc = ${input.keyEnc}, key_prefix = ${input.keyPrefix}, status = 'ok', last_tested_at = ${input.at}, updated_at = ${input.at} where id = ${id} and kind = 'billing'`
}

export const deleteBillingGateway = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`delete from partner_credential where id = ${id} and kind = 'billing'`
}

/** System scope only: the keys plan billing uses, live where the partner has connected them, else test. */
export const selectSealedBillingGateway = async (tx: ScopedSql, partnerId: string, mode?: GatewayMode): Promise<{ mode: GatewayMode; key_enc: string } | null> =>
  (
    await tx<{ mode: GatewayMode; key_enc: string }[]>`
      select settings->>'mode' as mode, key_enc from partner_credential
      where partner_id = ${partnerId} and kind = 'billing' and provider = 'razorpay' ${mode ? tx`and settings->>'mode' = ${mode}` : tx``}
      order by (settings->>'mode') = 'live' desc limit 1`
  )[0] ?? null

/** Whether the partner has Razorpay keys connected for plan billing, in either mode. */
export const hasBillingGateway = async (tx: ScopedSql, partnerId: string): Promise<boolean> => (await billingGatewayMode(tx, partnerId)) !== null

/** The mode a new plan payment uses: live where connected, else test (selectSealedBillingGateway's order); null with none. */
export const billingGatewayMode = async (tx: ScopedSql, partnerId: string): Promise<GatewayMode | null> =>
  (await tx<{ mode: GatewayMode }[]>`select settings->>'mode' as mode from partner_credential where partner_id = ${partnerId} and kind = 'billing' and provider = 'razorpay' order by (settings->>'mode') = 'live' desc limit 1`)[0]?.mode ?? null

// ---- The partner's plans as Razorpay plans ----

export interface PlanKey {
  partnerId: string
  mode: GatewayMode
  planId: string
  planVersion: number
  interval: 'month' | 'year'
  currency: string
  amount: number
}

export const selectRazorpayPlan = async (tx: ScopedSql, k: PlanKey): Promise<string | null> =>
  (
    await tx<{ razorpay_plan_id: string }[]>`
      select razorpay_plan_id from razorpay_plan where partner_id = ${k.partnerId} and mode = ${k.mode} and plan_id = ${k.planId}
        and plan_version = ${k.planVersion} and interval = ${k.interval} and currency = ${k.currency} and amount = ${k.amount}`
  )[0]?.razorpay_plan_id ?? null

/** Kept once; a plan made twice at the same moment keeps the first, and the second is never used. */
export const insertRazorpayPlan = async (tx: ScopedSql, k: PlanKey, razorpayPlanId: string): Promise<string> =>
  (
    await tx<{ razorpay_plan_id: string }[]>`
      insert into razorpay_plan (partner_id, mode, plan_id, plan_version, interval, currency, amount, razorpay_plan_id)
      values (${k.partnerId}, ${k.mode}, ${k.planId}, ${k.planVersion}, ${k.interval}, ${k.currency}, ${k.amount}, ${razorpayPlanId})
      on conflict (partner_id, mode, plan_id, plan_version, interval, currency, amount) do update set partner_id = excluded.partner_id
      returning razorpay_plan_id`
  )[0]?.razorpay_plan_id ?? razorpayPlanId

/** Which of the partner's plans a Razorpay plan is, to read a renewal or a change Razorpay made. */
export const selectPlanByRazorpayId = async (tx: ScopedSql, partnerId: string, mode: GatewayMode, razorpayPlanId: string): Promise<Omit<PlanKey, 'partnerId' | 'mode'> | null> =>
  (
    await tx<{ planId: string; planVersion: number; interval: 'month' | 'year'; currency: string; amount: number }[]>`
      select plan_id as "planId", plan_version as "planVersion", interval, currency, amount::int as amount
      from razorpay_plan where partner_id = ${partnerId} and mode = ${mode} and razorpay_plan_id = ${razorpayPlanId}`
  )[0] ?? null

// ---- The store's subscription on Razorpay (system scope, by the caller's own store id) ----

/** A card is kept as Stripe's are (brand, last four); UPI as brand `upi` with its masked handle in the label. */
export const saveRazorpaySubscription = async (
  tx: ScopedSql,
  storeId: string,
  s: { subscriptionId: string; customerId: string | null; mode: GatewayMode; method: { kind: 'card'; brand: string; last4: string } | { kind: 'upi'; handle: string } | null },
): Promise<void> => {
  const m = s.method
  await tx`
    update store_subscription set razorpay_subscription_id = ${s.subscriptionId}, razorpay_customer_id = coalesce(${s.customerId}, razorpay_customer_id),
      razorpay_mode = ${s.mode}, billing_revision = billing_revision + 1
      ${m ? tx`, payment_method_brand = ${m.kind === 'upi' ? 'upi' : m.brand}, payment_method_last4 = ${m.kind === 'card' ? m.last4 : null},
        payment_method_label = ${m.kind === 'upi' ? m.handle : null}, payment_method_expires = null` : tx``}
    where store_id = ${storeId}`
}

/** A store moved to a free plan has no subscription left on Razorpay: a paid plan later is a first payment again. */
export const endRazorpaySubscription = async (tx: ScopedSql, storeId: string): Promise<void> => {
  await tx`update store_subscription set razorpay_subscription_id = null, billing_revision = billing_revision + 1 where store_id = ${storeId}`
}

/** The store whose Razorpay subscription this is, locked. */
export const selectStoreByRazorpaySubscription = async (tx: ScopedSql, partnerId: string, subscriptionId: string): Promise<{ store_id: string } | null> =>
  (await tx<{ store_id: string }[]>`select store_id from store_subscription where partner_id = ${partnerId} and razorpay_subscription_id = ${subscriptionId} for update`)[0] ?? null

/** One store subscription in a mode, to tell whether new keys are the same Razorpay account. */
export const selectAnyRazorpaySubscription = async (tx: ScopedSql, partnerId: string, mode: GatewayMode): Promise<string | null> =>
  (await tx<{ id: string }[]>`select razorpay_subscription_id as id from store_subscription where partner_id = ${partnerId} and razorpay_mode = ${mode} and razorpay_subscription_id is not null limit 1`)[0]?.id ?? null

/** A partner that connects another Razorpay account (or none) leaves its stores' subscriptions on the old one: they subscribe again. */
export const forgetRazorpaySubscriptions = async (tx: ScopedSql, partnerId: string, mode: GatewayMode): Promise<void> => {
  await tx`
    update store_subscription set razorpay_subscription_id = null, razorpay_customer_id = null, razorpay_mode = null, payment_method_label = null, payment_method_brand = null, payment_method_last4 = null,
      billing_revision = billing_revision + 1
    where partner_id = ${partnerId} and razorpay_mode = ${mode}`
}

// ---- Payments on a subscription ----

export interface PlanChargeRow {
  id: string
  store_id: string
  partner_id: string
  kind: 'subscribe' | 'renewal'
  mode: GatewayMode
  plan_id: string
  plan_version: number
  interval: 'month' | 'year'
  amount: number
  currency: string
  razorpay_subscription_id: string
  razorpay_payment_id: string | null
  period_start: Date | null
  period_end: Date | null
  status: 'pending' | 'captured'
  change_when: 'now' | 'period_end' | null
}

const chargeColumns = `id, store_id, partner_id, kind, mode, plan_id, plan_version, interval, amount::int as amount, currency, razorpay_subscription_id,
  razorpay_payment_id, period_start, period_end, status, change_when`

/** The subscription's first payment, waiting for Checkout: what it is for, so confirming it applies the right plan. */
export const insertSubscribeCharge = async (
  tx: ScopedSql,
  c: Pick<PlanChargeRow, 'store_id' | 'partner_id' | 'mode' | 'plan_id' | 'plan_version' | 'interval' | 'amount' | 'currency' | 'razorpay_subscription_id' | 'change_when' | 'period_start' | 'period_end'>,
): Promise<void> => {
  await tx`
    insert into store_plan_charge (store_id, partner_id, kind, mode, plan_id, plan_version, interval, amount, currency, razorpay_subscription_id, change_when, period_start, period_end)
    values (${c.store_id}, ${c.partner_id}, 'subscribe', ${c.mode}, ${c.plan_id}, ${c.plan_version}, ${c.interval}, ${c.amount}, ${c.currency}, ${c.razorpay_subscription_id},
      ${c.change_when}, ${c.period_start}, ${c.period_end})`
}

export const selectSubscribeCharge = async (tx: ScopedSql, partnerId: string, subscriptionId: string): Promise<PlanChargeRow | null> =>
  (await tx<PlanChargeRow[]>`select ${tx.unsafe(chargeColumns)} from store_plan_charge where partner_id = ${partnerId} and razorpay_subscription_id = ${subscriptionId} and kind = 'subscribe' for update`)[0] ?? null

export const markChargeCaptured = async (tx: ScopedSql, id: string, p: { paymentId: string | null; periodStart: Date; periodEnd: Date }, at: Date): Promise<void> => {
  await tx`
    update store_plan_charge set status = 'captured', razorpay_payment_id = coalesce(${p.paymentId}, razorpay_payment_id), period_start = ${p.periodStart},
      period_end = ${p.periodEnd}, updated_at = ${at}
    where id = ${id}`
}

/** A renewal Razorpay charged, recorded once per subscription and period; false when it already was. */
export const insertRenewal = async (
  tx: ScopedSql,
  c: Pick<PlanChargeRow, 'store_id' | 'partner_id' | 'mode' | 'plan_id' | 'plan_version' | 'interval' | 'amount' | 'currency' | 'razorpay_subscription_id' | 'razorpay_payment_id'> & { period_start: Date; period_end: Date },
): Promise<boolean> =>
  (
    await tx`
      insert into store_plan_charge (store_id, partner_id, kind, mode, plan_id, plan_version, interval, amount, currency, razorpay_subscription_id, razorpay_payment_id, period_start, period_end, status)
      values (${c.store_id}, ${c.partner_id}, 'renewal', ${c.mode}, ${c.plan_id}, ${c.plan_version}, ${c.interval}, ${c.amount}, ${c.currency}, ${c.razorpay_subscription_id},
        ${c.razorpay_payment_id}, ${c.period_start}, ${c.period_end}, 'captured')
      on conflict (razorpay_subscription_id, period_start) where kind = 'renewal' do nothing returning id`
  ).length > 0

// ---- Following Razorpay (SAAS §7.4) ----

/** The period moves on to the one Razorpay charged; a scheduled change that subscription carries is applied with it. */
export const advancePeriod = async (tx: ScopedSql, storeId: string, p: { periodStart: Date; periodEnd: Date; planId: string; planVersion: number; interval: 'month' | 'year'; amount: number }): Promise<void> => {
  await tx`
    update store_subscription set period_start = ${p.periodStart}, period_end = ${p.periodEnd}, plan_id = ${p.planId}, plan_version = ${p.planVersion},
      interval = ${p.interval}, amount = ${p.amount}, status = 'active',
      next_plan_id = case when next_plan_id = ${p.planId} then null else next_plan_id end,
      next_plan_version = case when next_plan_id = ${p.planId} then null else next_plan_version end,
      next_interval = case when next_plan_id = ${p.planId} then null else next_interval end,
      change_at = case when next_plan_id = ${p.planId} then null else change_at end,
      billing_revision = billing_revision + 1
    where store_id = ${storeId}`
  await tx`update store set plan_id = ${p.planId} where id = ${storeId}`
}

/** A plan change approved in Checkout in the last day whose confirmation hasn't landed: the old subscription ends first. */
export const hasChangeUnderway = async (tx: ScopedSql, storeId: string, at: Date): Promise<boolean> =>
  (await tx`select 1 from store_plan_charge where store_id = ${storeId} and kind = 'subscribe' and status = 'pending' and change_when is not null and created_at > ${new Date(at.getTime() - 86_400_000)} limit 1`).length > 0

export const markSubscriptionPastDue = async (tx: ScopedSql, storeId: string): Promise<void> => {
  await tx`update store_subscription set status = 'past_due' where store_id = ${storeId} and status in ('active', 'trial')`
}

export interface RazorpayStoreEnding {
  store_id: string
  partner_id: string
  period_end: Date
  razorpay_subscription_id: string
  razorpay_mode: GatewayMode
}

/** Stores on a Razorpay subscription whose period ends in (from, until], a page at a time after `after`. */
export const selectRazorpayStoresEnding = (tx: ScopedSql, from: Date, until: Date, limit: number, after: { periodEnd: Date; storeId: string } | null = null): Promise<RazorpayStoreEnding[]> =>
  tx<RazorpayStoreEnding[]>`
    select sub.store_id, sub.partner_id, sub.period_end, sub.razorpay_subscription_id, sub.razorpay_mode from store_subscription sub
    join store s on s.id = sub.store_id
    where sub.razorpay_subscription_id is not null and sub.status in ('active', 'past_due') and sub.cancel_at is null and sub.amount > 0
      and sub.period_end > ${from} and sub.period_end <= ${until} and s.status in ('active', 'past_due', 'suspended')
      ${after ? tx`and (sub.period_end, sub.store_id) > (${after.periodEnd}, ${after.storeId})` : tx``}
    order by sub.period_end, sub.store_id limit ${limit}`

/** A plan version's price in a currency for an interval; null where it has none. */
export const selectPlanPrice = async (tx: ScopedSql, planId: string, version: number, currency: string, interval: 'month' | 'year'): Promise<number | null> => {
  const row = (await tx<{ monthly_amount: number | null; yearly_amount: number | null }[]>`select monthly_amount, yearly_amount from plan_price where plan_id = ${planId} and version = ${version} and currency = ${currency}`)[0]
  return (interval === 'year' ? row?.yearly_amount : row?.monthly_amount) ?? null
}
