import type postgres from 'postgres'
import type { PageWindow } from '#core/paging'
import { pgArray, type ScopedSql } from './index'

// Offers (migration 0076; DATA-MODEL §7.7), the merchant side's, read and written in its own store scope. Status is derived
// here as OFFERS fact 9 orders it, so the tabs, their counts and the list can't disagree.

export type OfferStatusFilter = 'live' | 'scheduled' | 'off' | 'ended'
export type OfferKind = 'products' | 'order' | 'bxgy' | 'shipping'

export interface StoredRule {
  operation: string
  args: Record<string, unknown>
}

export interface OfferRow {
  id: string
  name: string
  internal_name: string | null
  description: string | null
  trigger: 'automatic' | 'code'
  enabled: boolean
  starts_at: Date | null
  ends_at: Date | null
  total_uses_limit: number | null
  per_customer_limit: number | null
  uses_count: number
  combines_with: { product: boolean; order: boolean; shipping: boolean }
  created_at: Date
  updated_at: Date
  revision: number
  /** The shared code shoppers type now; null for an automatic offer or one with only single-use codes. */
  code: string | null
  conditions: StoredRule[]
  action: StoredRule | null
}

const kinds: Record<OfferKind, readonly string[]> = {
  products: ['products_percentage_discount', 'line_fixed_discount'],
  order: ['order_percentage_discount', 'order_fixed_discount', 'tiered_discount'],
  bxgy: ['buy_x_get_y'],
  shipping: ['free_shipping', 'shipping_fixed_discount'],
}

/** Fact 9's order: off, then ended or used up (one tab, B1), then scheduled, else live. */
const statusIs = (tx: ScopedSql, status: OfferStatusFilter, now: Date) => {
  const ended = tx`((p.ends_at is not null and p.ends_at <= ${now}) or (p.total_uses_limit is not null and p.uses_count >= p.total_uses_limit))`
  switch (status) {
    case 'off':
      return tx`not p.enabled`
    case 'ended':
      return tx`p.enabled and ${ended}`
    case 'scheduled':
      return tx`p.enabled and not ${ended} and p.starts_at is not null and p.starts_at > ${now}`
    case 'live':
      return tx`p.enabled and not ${ended} and (p.starts_at is null or p.starts_at <= ${now})`
  }
}

const columns = (tx: ScopedSql) => tx`
  p.id, p.name, p.internal_name, p.description, p.trigger, p.enabled, p.starts_at, p.ends_at, p.total_uses_limit, p.per_customer_limit,
  p.uses_count, p.combines_with, p.created_at, p.updated_at, p.revision,
  (select c.code from promotion_code c where c.promotion_id = p.id and c.batch_id is null and c.replaced_at is null limit 1) as code,
  coalesce((select json_agg(json_build_object('operation', r.operation, 'args', r.args) order by r.position) from promotion_condition r where r.promotion_id = p.id), '[]'::json) as conditions,
  (select json_build_object('operation', a.operation, 'args', a.args) from promotion_action a where a.promotion_id = p.id order by a.position limit 1) as action
`

export interface OfferFilter {
  status: OfferStatusFilter | null
  kind: OfferKind | null
  trigger: 'automatic' | 'code' | null
  search: string | null
}

const like = (s: string) => `%${s.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')}%`

const matching = (tx: ScopedSql, f: OfferFilter, now: Date) => tx`
  ${f.status ? statusIs(tx, f.status, now) : tx`true`}
  and ${f.kind ? tx`exists (select 1 from promotion_action a where a.promotion_id = p.id and a.operation = any (${pgArray(kinds[f.kind])}::text[]))` : tx`true`}
  and ${f.trigger ? tx`p.trigger = ${f.trigger}` : tx`true`}
  ${
    // A shared code by any part of it; a single-use code never, so search can't stand in for the rate-limited checkCode.
    f.search
      ? tx`and (p.name ilike ${like(f.search)} or p.internal_name ilike ${like(f.search)}
          or exists (select 1 from promotion_code c where c.promotion_id = p.id and c.batch_id is null and c.code ilike ${like(f.search)}))`
      : tx``
  }
`

export const selectOffers = (tx: ScopedSql, storeId: string, f: OfferFilter, window: PageWindow, now: Date): Promise<OfferRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<OfferRow[]>`
    select ${columns(tx)} from promotion p
    where p.store_id = ${storeId} and p.deleted_at is null and not p.cart_reminder and ${matching(tx, f, now)}
      and ${window.after ? tx`(p.created_at, p.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(p.created_at, p.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by p.created_at ${backwards ? tx`asc` : tx`desc`}, p.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

/** The tabs' counts (B1), each the same rule the list filters by. */
export const countOffers = async (tx: ScopedSql, storeId: string, now: Date): Promise<Record<OfferStatusFilter, number>> => {
  const [row] = await tx<Record<OfferStatusFilter, number>[]>`
    select count(*) filter (where ${statusIs(tx, 'live', now)})::int as live, count(*) filter (where ${statusIs(tx, 'scheduled', now)})::int as scheduled,
      count(*) filter (where ${statusIs(tx, 'off', now)})::int as off, count(*) filter (where ${statusIs(tx, 'ended', now)})::int as ended
    from promotion p where p.store_id = ${storeId} and p.deleted_at is null and not p.cart_reminder
  `
  return row ?? { live: 0, scheduled: 0, off: 0, ended: 0 }
}

export const selectOffer = async (tx: ScopedSql, storeId: string, id: string): Promise<OfferRow | null> =>
  (await tx<OfferRow[]>`select ${columns(tx)} from promotion p where p.id = ${id} and p.store_id = ${storeId} and p.deleted_at is null`)[0] ?? null

// The reminders' own offers (cartReminders.ts) are listed, counted and changed only by their settings, never here.
export const lockOffer = async (tx: ScopedSql, storeId: string, id: string): Promise<OfferRow | null> => {
  const locked = await tx<{ id: string }[]>`select id from promotion where id = ${id} and store_id = ${storeId} and deleted_at is null and not cart_reminder for update`
  return locked.length > 0 ? selectOffer(tx, storeId, id) : null
}

/** Offers that count against the plan's live limit: on, not ended, not used up; scheduled ones too, as they will go live. */
export const countOnOffers = async (tx: ScopedSql, storeId: string, now: Date): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from promotion p
      where p.store_id = ${storeId} and p.deleted_at is null and not p.cart_reminder and p.enabled and (p.ends_at is null or p.ends_at > ${now})
        and (p.total_uses_limit is null or p.uses_count < p.total_uses_limit)
    `
  )[0]?.n ?? 0

export interface OfferWrite {
  name: string
  internalName: string | null
  description: string | null
  trigger: 'automatic' | 'code'
  enabled: boolean
  startsAt: Date | null
  endsAt: Date | null
  totalUsesLimit: number | null
  perCustomerLimit: number | null
  combines: { product: boolean; order: boolean; shipping: boolean }
}

export const insertOffer = async (tx: ScopedSql, storeId: string, o: OfferWrite, byUserId: string): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into promotion (store_id, name, internal_name, description, trigger, enabled, starts_at, ends_at, total_uses_limit, per_customer_limit, combines_with, created_by_user_id)
    values (${storeId}, ${o.name}, ${o.internalName}, ${o.description}, ${o.trigger}, ${o.enabled}, ${o.startsAt}, ${o.endsAt}, ${o.totalUsesLimit}, ${o.perCustomerLimit},
      ${tx.json(o.combines)}, ${byUserId})
    returning id
  `
  if (!row) throw new Error('promotion: insert returned no row')
  return row.id
}

export const updateOffer = async (tx: ScopedSql, id: string, o: OfferWrite, now: Date): Promise<number> => {
  const [row] = await tx<{ revision: number }[]>`
    update promotion set name = ${o.name}, internal_name = ${o.internalName}, description = ${o.description}, trigger = ${o.trigger}, enabled = ${o.enabled},
      starts_at = ${o.startsAt}, ends_at = ${o.endsAt}, total_uses_limit = ${o.totalUsesLimit}, per_customer_limit = ${o.perCustomerLimit},
      combines_with = ${tx.json(o.combines)}, updated_at = ${now}, revision = revision + 1
    where id = ${id} returning revision
  `
  if (!row) throw new Error('promotion: update found no row')
  return row.revision
}

/** The offer's conditions and action become exactly these, in order. */
export const replaceRules = async (tx: ScopedSql, storeId: string, id: string, conditions: readonly StoredRule[], action: StoredRule): Promise<void> => {
  await tx`delete from promotion_condition where promotion_id = ${id}`
  await tx`delete from promotion_action where promotion_id = ${id}`
  for (const [position, c] of conditions.entries()) {
    await tx`insert into promotion_condition (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, ${c.operation}, ${tx.json(c.args as postgres.JSONValue)}, ${position})`
  }
  await tx`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${id}, ${storeId}, ${action.operation}, ${tx.json(action.args as postgres.JSONValue)}, 0)`
}

export const setOfferState = async (tx: ScopedSql, id: string, change: { enabled?: boolean; endNow?: Date; deletedAt?: Date }, now: Date): Promise<number> => {
  const [row] = await tx<{ revision: number }[]>`
    update promotion set
      enabled = ${change.enabled ?? tx`enabled`},
      ${change.endNow ? tx`starts_at = case when starts_at >= ${change.endNow} then null else starts_at end, ends_at = ${change.endNow},` : tx``}
      deleted_at = ${change.deletedAt ?? tx`deleted_at`},
      updated_at = ${now}, revision = revision + 1
    where id = ${id} returning revision
  `
  return row?.revision ?? 0
}

export interface CodeOwnerRow {
  code_id: string
  promotion_id: string
  name: string
  replaced: boolean
  single_use: boolean
  deleted: boolean
  enabled: boolean
  starts_at: Date | null
  ends_at: Date | null
  uses_count: number
  total_uses_limit: number | null
}

/** Whichever offer holds this code in the store, whatever its case and whether that offer is deleted (H2). */
export const selectCodeOwner = async (tx: ScopedSql, storeId: string, code: string): Promise<CodeOwnerRow | null> =>
  (
    await tx<CodeOwnerRow[]>`
      select c.id as code_id, p.id as promotion_id, p.name, c.replaced_at is not null as replaced, c.single_use, p.deleted_at is not null as deleted,
        p.enabled, p.starts_at, p.ends_at, p.uses_count, p.total_uses_limit
      from promotion_code c join promotion p on p.id = c.promotion_id
      where c.store_id = ${storeId} and lower(c.code) = lower(${code})
    `
  )[0] ?? null

/** The offer's shared code becomes `code` (null: none); the one it replaces stops working and stays this offer's (H5). */
export const setSharedCode = async (tx: ScopedSql, storeId: string, id: string, code: string | null, now: Date): Promise<void> => {
  await tx`update promotion_code set replaced_at = ${now} where promotion_id = ${id} and batch_id is null and replaced_at is null and (${code}::text is null or code <> ${code})`
  if (code === null) return
  const back = await tx`update promotion_code set replaced_at = null where promotion_id = ${id} and batch_id is null and code = ${code}`
  if (back.count === 0) await tx`insert into promotion_code (promotion_id, store_id, code) values (${id}, ${storeId}, ${code})`
}

/** How many of these ids are the store's own live rows of their kind: what an offer may name (facts 5, 12). */
export const countKnownIds = async (tx: ScopedSql, storeId: string, ids: { products: string[]; collections: string[]; filterValues: string[]; groups: string[]; customers: string[] }): Promise<number> => {
  const kinds = [
    ['product', ids.products, tx`deleted_at is null`],
    ['collection', ids.collections, tx`deleted_at is null`],
    ['filter_value', ids.filterValues, tx`true`],
    ['customer_group', ids.groups, tx`deleted_at is null`],
    ['customer', ids.customers, tx`status <> 'deleted'`],
  ] as const
  let known = 0
  for (const [table, list, live] of kinds) {
    if (list.length === 0) continue
    known += (await tx<{ n: number }[]>`select count(*)::int as n from ${tx(table)} where store_id = ${storeId} and id = any (${pgArray(list)}::uuid[]) and ${live}`)[0]?.n ?? 0
  }
  return known
}

/** The currencies the store sells in: its main one and every active other (Settings › Store info). */
export const selectStoreCurrencies = async (tx: ScopedSql, storeId: string): Promise<string[]> =>
  (
    await tx<{ currency: string }[]>`
      select pricing_currency as currency from store where id = ${storeId} and pricing_currency is not null
      union select currency from store_currency where store_id = ${storeId} and status = 'active'
    `
  ).map((r) => r.currency)

export interface CodeBatchRow {
  id: string
  prefix: string
  length: number
  count: number
  used: number
  created_at: Date
}

const batchColumns = (tx: ScopedSql) => tx`
  b.id, b.prefix, b.length, b.count, b.created_at,
  (select count(*)::int from promotion_code c where c.promotion_id = b.promotion_id and c.batch_id = b.id and c.used_at is not null) as used
`

/** An offer's runs of single-use codes, newest first, a page at a time, each with how many are used (H4). */
export const selectCodeBatches = (tx: ScopedSql, storeId: string, promotionId: string, window: PageWindow): Promise<CodeBatchRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<CodeBatchRow[]>`
    select ${batchColumns(tx)} from promotion_code_batch b
    where b.store_id = ${storeId} and b.promotion_id = ${promotionId}
      and ${window.after ? tx`(b.created_at, b.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(b.created_at, b.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by b.created_at ${backwards ? tx`asc` : tx`desc`}, b.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export const selectCodeBatch = async (tx: ScopedSql, storeId: string, batchId: string): Promise<CodeBatchRow | null> =>
  (await tx<CodeBatchRow[]>`select ${batchColumns(tx)} from promotion_code_batch b where b.store_id = ${storeId} and b.id = ${batchId}`)[0] ?? null

export const countCodes = async (tx: ScopedSql, promotionId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from promotion_code where promotion_id = ${promotionId} and batch_id is not null`)[0]?.n ?? 0

export const insertCodeBatch = async (tx: ScopedSql, storeId: string, promotionId: string, b: { prefix: string; length: number; count: number }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into promotion_code_batch (promotion_id, store_id, prefix, length, count) values (${promotionId}, ${storeId}, ${b.prefix}, ${b.length}, ${b.count}) returning id
  `
  if (!row) throw new Error('promotion_code_batch: insert returned no row')
  return row.id
}

/** Single-use codes, skipping any the store already holds in any case; how many went in. */
export const insertSingleUseCodes = async (tx: ScopedSql, storeId: string, promotionId: string, batchId: string, codes: readonly string[]): Promise<number> =>
  (
    await tx`
      insert into promotion_code (promotion_id, store_id, batch_id, code, single_use)
      select ${promotionId}, ${storeId}, ${batchId}, c, true from unnest(${pgArray(codes)}::text[]) c
      on conflict (store_id, lower(code)) do nothing
    `
  ).count

export const selectBatchCodes = (tx: ScopedSql, storeId: string, batchId: string): Promise<{ code: string; used_at: Date | null }[]> =>
  tx<{ code: string; used_at: Date | null }[]>`select code, used_at from promotion_code where store_id = ${storeId} and batch_id = ${batchId} order by code`

export const selectBatch = async (tx: ScopedSql, storeId: string, batchId: string): Promise<{ id: string; promotion_id: string; name: string } | null> =>
  (
    await tx<{ id: string; promotion_id: string; name: string }[]>`
      select b.id, b.promotion_id, p.name from promotion_code_batch b join promotion p on p.id = b.promotion_id
      where b.id = ${batchId} and b.store_id = ${storeId} and p.deleted_at is null
    `
  )[0] ?? null

export interface CodeCheckRow {
  code: string
  promotion_id: string
  single_use: boolean
  used_at: Date | null
  expires_at: Date | null
  replaced: boolean
  deleted: boolean
}

/** The code in this store whatever its case, with what a shopper would meet; null when the store has none. */
export const selectCodeCheck = async (tx: ScopedSql, storeId: string, code: string): Promise<CodeCheckRow | null> =>
  (
    await tx<CodeCheckRow[]>`
      select c.code, c.promotion_id, c.single_use, c.used_at, c.expires_at, c.replaced_at is not null as replaced, p.deleted_at is not null as deleted
      from promotion_code c join promotion p on p.id = c.promotion_id
      where c.store_id = ${storeId} and lower(c.code) = lower(${code})
    `
  )[0] ?? null

export interface OfferResultsRow {
  uses: number
  given: { amount: string; currency: string }[]
  sales: { amount: string; currency: string; orders: number }[]
  by_day: { day: string; uses: number }[]
}

/** What an offer did (P1), from its placed orders' usage rows: by currency, and by day in the store's time zone. */
export const selectOfferResults = async (tx: ScopedSql, storeId: string, promotionId: string, since: Date): Promise<OfferResultsRow> => {
  const [row] = await tx<OfferResultsRow[]>`
    with u as (
      select u.discount_amount, u.currency, u.created_at, o.total_amount
      from promotion_usage u join "order" o on o.id = u.order_id
      where u.store_id = ${storeId} and u.promotion_id = ${promotionId}
    ), tz as (select coalesce(time_zone, 'UTC') as zone from store where id = ${storeId})
    select (select count(*)::int from u) as uses,
      coalesce((select json_agg(json_build_object('amount', s::text, 'currency', currency) order by currency) from (select currency, sum(discount_amount) as s from u group by currency) g), '[]'::json) as given,
      coalesce((select json_agg(json_build_object('amount', s::text, 'currency', currency, 'orders', n) order by currency) from (select currency, sum(total_amount) as s, count(*)::int as n from u group by currency) g), '[]'::json) as sales,
      coalesce((select json_agg(json_build_object('day', day, 'uses', n) order by day) from (
        select to_char((u.created_at at time zone (select zone from tz))::date, 'YYYY-MM-DD') as day, count(*)::int as n from u where u.created_at >= ${since} group by 1) d), '[]'::json) as by_day
  `
  return row ?? { uses: 0, given: [], sales: [], by_day: [] }
}

// Pricing a cart and placing it (part 4): read and written in system scope, as the shopper reads no offer (DATA-MODEL §7.11).

export interface CartOfferRow {
  id: string
  name: string
  trigger: 'automatic' | 'code'
  enabled: boolean
  starts_at: Date | null
  ends_at: Date | null
  uses_count: number
  total_uses_limit: number | null
  per_customer_limit: number | null
  combines_with: { product: boolean; order: boolean; shipping: boolean }
  created_at: Date
  deleted: boolean
  conditions: StoredRule[]
  action: StoredRule | null
  /** The code the shopper typed that names this offer, with its own state; null for an automatic offer. */
  code_id: string | null
  code: string | null
  single_use: boolean
  used_at: Date | null
  expires_at: Date | null
  replaced: boolean
  /** The one cart a reminder's code works on; null for every other code (migration 0120). */
  code_order_id: string | null
}

/** Every automatic offer on now, and the offer behind each code the cart holds, whatever state it is in. */
export const selectCartOffers = (tx: ScopedSql, storeId: string, codes: readonly string[], now: Date): Promise<CartOfferRow[]> =>
  tx<CartOfferRow[]>`
    select p.id, p.name, p.trigger, p.enabled, p.starts_at, p.ends_at, p.uses_count, p.total_uses_limit, p.per_customer_limit, p.combines_with, p.created_at,
      p.deleted_at is not null as deleted,
      coalesce((select json_agg(json_build_object('operation', r.operation, 'args', r.args) order by r.position) from promotion_condition r where r.promotion_id = p.id), '[]'::json) as conditions,
      (select json_build_object('operation', a.operation, 'args', a.args) from promotion_action a where a.promotion_id = p.id order by a.position limit 1) as action,
      c.id as code_id, c.code, coalesce(c.single_use, false) as single_use, c.used_at, c.expires_at, coalesce(c.replaced_at is not null, false) as replaced,
      c.order_id as code_order_id
    from promotion p
    left join promotion_code c on c.promotion_id = p.id and c.store_id = p.store_id and lower(c.code) = any (${pgArray(codes.map((x) => x.toLowerCase()))}::text[])
    where p.store_id = ${storeId}
      and (c.id is not null
        or (p.trigger = 'automatic' and p.deleted_at is null and p.enabled and (p.starts_at is null or p.starts_at <= ${now}) and (p.ends_at is null or p.ends_at > ${now})
          and (p.total_uses_limit is null or p.uses_count < p.total_uses_limit)))
    order by p.created_at, p.id
  `

/** How often a signed-in shopper has used each offer, by account only: an order's email is whatever its placer typed (fact 8). */
export const selectShopperUses = async (tx: ScopedSql, storeId: string, ids: readonly string[], customerId: string | null): Promise<Map<string, number>> => {
  if (ids.length === 0 || customerId === null) return new Map()
  const rows = await tx<{ promotion_id: string; n: number }[]>`
    select promotion_id, count(*)::int as n from promotion_usage
    where store_id = ${storeId} and promotion_id = any (${pgArray(ids)}::uuid[]) and customer_id = ${customerId}
    group by promotion_id
  `
  return new Map(rows.map((r) => [r.promotion_id, r.n]))
}

export interface CartShopperRow {
  time_zone: string
  group_ids: string[]
  has_ordered: boolean
}

/** The facts a cart's conditions read about a signed-in shopper: their groups, whether they have ordered here, the store's time zone. */
export const selectCartShopper = async (tx: ScopedSql, storeId: string, customerId: string | null): Promise<CartShopperRow> => {
  const [row] = await tx<CartShopperRow[]>`
    select s.time_zone,
      to_json(array(select m.group_id from customer_group_member m join customer_group g on g.id = m.group_id and g.deleted_at is null
        where m.store_id = s.id and m.customer_id = ${customerId})) as group_ids,
      ${customerId === null ? tx`false` : tx`exists (select 1 from "order" o where o.store_id = s.id and o.state = 'placed' and o.customer_id = ${customerId})`} as has_ordered
    from store s where s.id = ${storeId}
  `
  return row ?? { time_zone: 'UTC', group_ids: [], has_ordered: false }
}

/** Each product's collections and filter values, so targets resolve when the cart is priced (fact 5, #337). */
export const selectProductTargets = async (tx: ScopedSql, storeId: string, productIds: readonly string[]): Promise<Map<string, { collections: string[]; filterValues: string[] }>> => {
  if (productIds.length === 0) return new Map()
  const rows = await tx<{ id: string; collections: string[]; filter_values: string[] }[]>`
    select p.id,
      to_json(array(select cp.collection_id from collection_product cp join collection c on c.id = cp.collection_id and c.deleted_at is null where cp.product_id = p.id)) as collections,
      to_json(array(select f.filter_value_id from product_filter_value f where f.product_id = p.id)) as filter_values
    from product p where p.store_id = ${storeId} and p.id = any (${pgArray(productIds)}::uuid[])
  `
  return new Map(rows.map((r) => [r.id, { collections: r.collections, filterValues: r.filter_values }]))
}

/**
 * One use of the offer for an order being placed, if it still has one: the row's lock and the re-checked condition make a
 * second order racing for the last use wait for the first and then find none (fact 8; PLATFORM-PROMPT §5.9).
 */
export const claimUse = async (tx: ScopedSql, storeId: string, promotionId: string, now: Date): Promise<boolean> =>
  (
    await tx`
      update promotion set uses_count = uses_count + 1
      where id = ${promotionId} and store_id = ${storeId} and deleted_at is null and enabled
        and (starts_at is null or starts_at <= ${now}) and (ends_at is null or ends_at > ${now})
        and (total_uses_limit is null or uses_count < total_uses_limit)
    `
  ).count > 0

/** The code the order was priced with, checked again: a single-use one is taken; false when it was taken, replaced or ended meanwhile. */
export const claimCode = async (tx: ScopedSql, storeId: string, codeId: string, now: Date): Promise<boolean> =>
  (
    await tx`
      update promotion_code set used_at = case when single_use then ${now} else used_at end
      where id = ${codeId} and store_id = ${storeId} and replaced_at is null and (expires_at is null or expires_at > ${now}) and (not single_use or used_at is null)
    `
  ).count > 0

export const insertUsage = async (
  tx: ScopedSql,
  u: { promotionId: string; codeId: string | null; storeId: string; orderId: string; customerId: string | null; email: string | null; amount: bigint; currency: string },
): Promise<void> => {
  await tx`
    insert into promotion_usage (promotion_id, promotion_code_id, store_id, order_id, customer_id, customer_email, discount_amount, currency)
    values (${u.promotionId}, ${u.codeId}, ${u.storeId}, ${u.orderId}, ${u.customerId}, ${u.email}, ${u.amount.toString()}, ${u.currency})
  `
}

/** A cancellation before fulfilment gives each use back, a single-use code with it (#337); a refund never calls this. */
export const releaseUses = async (tx: ScopedSql, storeId: string, orderId: string): Promise<void> => {
  const gone = await tx<{ promotion_id: string; promotion_code_id: string | null }[]>`
    delete from promotion_usage where store_id = ${storeId} and order_id = ${orderId} returning promotion_id, promotion_code_id
  `
  for (const u of [...gone].sort((a, b) => a.promotion_id.localeCompare(b.promotion_id))) {
    await tx`update promotion set uses_count = greatest(uses_count - 1, 0) where id = ${u.promotion_id} and store_id = ${storeId}`
    if (u.promotion_code_id) await tx`update promotion_code set used_at = null where id = ${u.promotion_code_id} and store_id = ${storeId} and single_use`
  }
}

// A cart reminder's own code (SAPI 15, migration 0120), written in system scope by the reminders' job.

/** The store's hidden offer behind its reminders' codes at this percentage, made the first time it is needed. */
export const reminderOfferFor = async (tx: ScopedSql, storeId: string, percent: number, name: string): Promise<string> => {
  const [found] = await tx<{ id: string }[]>`
    select p.id from promotion p join promotion_action a on a.promotion_id = p.id
    where p.store_id = ${storeId} and p.cart_reminder and p.deleted_at is null and a.operation = 'order_percentage_discount' and (a.args ->> 'percent')::int = ${percent}
    order by p.created_at limit 1
  `
  if (found) return found.id
  // Combines with product and delivery offers, never another order discount (Carts: "doesn't combine with other codes").
  const [made] = await tx<{ id: string }[]>`
    insert into promotion (store_id, name, internal_name, trigger, enabled, combines_with, cart_reminder)
    values (${storeId}, ${name}, ${'Abandoned-cart reminders'}, 'code', true, ${tx.json({ product: true, order: false, shipping: true })}, true)
    returning id
  `
  if (!made) throw new Error('cart reminder: offer insert returned no row')
  await tx`insert into promotion_action (promotion_id, store_id, operation, args, position) values (${made.id}, ${storeId}, 'order_percentage_discount', ${tx.json({ percent, cap: null })}, 0)`
  return made.id
}

/** A single-use code bound to one cart and its shopper; null when the code is taken (the caller draws another). */
export const insertBoundCode = async (tx: ScopedSql, c: { storeId: string; promotionId: string; code: string; orderId: string; customerId: string | null; expiresAt: Date }): Promise<string | null> => {
  try {
    return await tx.savepoint(async (sp) => {
      const [row] = await sp<{ id: string }[]>`
        insert into promotion_code (promotion_id, store_id, code, single_use, expires_at, order_id, customer_id)
        values (${c.promotionId}, ${c.storeId}, ${c.code}, true, ${c.expiresAt}, ${c.orderId}, ${c.customerId}) returning id
      `
      return row?.id ?? null
    })
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505') return null
    throw error
  }
}
