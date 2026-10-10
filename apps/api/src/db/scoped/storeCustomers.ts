import type { PageWindow } from '#core/paging'
import type { CartAddress } from './cart'
import { pgArray, type ScopedSql } from './index'

// The store's customers on the merchant side (migration 0074; DATA-MODEL §7.5; FIRST-RELEASE §7), read and written in
// the caller's own scope: row security keeps them to the store's merchant side, so a supplier reaches none of it.

export type ConsentState = 'opted_in' | 'stopped' | 'declined' | 'not_asked'

export interface CustomerFilter {
  groupId: string | null
  search: string | null
}

export interface CustomerListRow {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  status: 'active' | 'unverified'
  tags: string[]
  city: string | null
  orders: number
  spent: { amount: string; currency: string }[]
  created_at: Date
}

export interface CustomerDetailRow extends CustomerListRow {
  note: string | null
  consent_state: ConsentState
  consent_at: Date | null
  consent_source: string | null
  consent_channels: string[]
  email_verified: boolean
  phone_verified: boolean
  group_ids: string[]
  addresses: (CartAddress & { id: string; isDefault: boolean })[]
  recent_orders: { id: string; number: string; placed_at: string; state: string; payment_state: string; fulfilment_state: string; total_amount: string; currency: string }[]
}

const like = (search: string) => `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

// A customer's orders: its own, and a guest's placed with its email (or, with none, its number); never a test order.
export const theirOrders = (tx: ScopedSql) => tx`
  o.store_id = c.store_id and o.state <> 'cart'
  and (o.customer_id = c.id or (o.customer_id is null and ((c.email is not null and o.email = c.email) or (c.phone is not null and o.email is null and o.phone = c.phone))))
  and not exists (select 1 from payment m where m.order_id = o.id and m.mode = 'test')
`

const listColumns = (tx: ScopedSql) => tx`
  c.id, c.name, c.email, c.phone, c.status, to_json(c.tags) as tags, c.created_at,
  coalesce((select a.city from customer_address a where a.customer_id = c.id and a.deleted_at is null order by a.is_default_shipping desc, a.created_at desc limit 1),
    (select o.shipping_address ->> 'city' from "order" o where ${theirOrders(tx)} order by o.placed_at desc limit 1)) as city,
  (select count(*)::int from "order" o where ${theirOrders(tx)}) as orders,
  -- Money taken, less what went back, a figure a currency.
  (select coalesce(json_agg(json_build_object('amount', x.amount::text, 'currency', x.currency) order by x.currency), '[]'::json)
    from (select o.currency, sum(o.total_amount - o.refunded_amount) as amount from "order" o
      where ${theirOrders(tx)} and o.payment_state in ('paid', 'partly_refunded', 'refunded') group by o.currency) x) as spent
`

const matches = (tx: ScopedSql, f: CustomerFilter) => tx`
  c.status <> 'deleted'
  and ${f.groupId ? tx`exists (select 1 from customer_group_member g where g.customer_id = c.id and g.group_id = ${f.groupId})` : tx`true`}
  and ${f.search ? tx`(c.name ilike ${like(f.search)} or c.email ilike ${like(f.search)} or c.phone ilike ${like(f.search)} or exists (select 1 from unnest(c.tags) t where t ilike ${like(f.search)}))` : tx`true`}
`

/** Newest first, a page at a time. */
export const selectStoreCustomers = (tx: ScopedSql, storeId: string, f: CustomerFilter, window: PageWindow): Promise<CustomerListRow[]> => {
  const backwards = window.before !== null && window.after === null
  return tx<CustomerListRow[]>`
    select ${listColumns(tx)} from customer c
    where c.store_id = ${storeId} and ${matches(tx, f)}
      and ${window.after ? tx`(c.created_at, c.id) < (${window.after.occurredAt}, ${window.after.id})` : tx`true`}
      and ${window.before ? tx`(c.created_at, c.id) > (${window.before.occurredAt}, ${window.before.id})` : tx`true`}
    order by c.created_at ${backwards ? tx`asc` : tx`desc`}, c.id ${backwards ? tx`asc` : tx`desc`}
    limit ${window.limit + 1}
  `
}

export const countStoreCustomers = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from customer c where c.store_id = ${storeId} and c.status <> 'deleted'`)[0]?.n ?? 0

/** The detail's newest orders; older ones are in Orders. */
export const recentOrdersShown = 20

export const selectStoreCustomer = async (tx: ScopedSql, storeId: string, id: string): Promise<CustomerDetailRow | null> =>
  (
    await tx<CustomerDetailRow[]>`
      select ${listColumns(tx)}, c.note, c.consent_state, c.consent_at, c.consent_source, to_json(c.consent_channels) as consent_channels,
        c.email_verified_at is not null as email_verified, c.phone_verified_at is not null as phone_verified,
        to_json(array(select g.group_id from customer_group_member g join customer_group k on k.id = g.group_id and k.deleted_at is null
          where g.customer_id = c.id order by k.name)) as group_ids,
        coalesce((select json_agg(json_build_object('id', a.id, 'name', a.name, 'line1', a.line1, 'line2', a.line2, 'city', a.city, 'region', a.region,
            'postalCode', a.postal_code, 'country', a.country, 'phone', a.phone, 'isDefault', a.is_default_shipping) order by a.is_default_shipping desc, a.created_at)
          from customer_address a where a.customer_id = c.id and a.deleted_at is null), '[]'::json) as addresses,
        coalesce((select json_agg(r order by r.placed_at desc) from (
          select o.id, o.number, o.placed_at, o.state, o.payment_state, o.fulfilment_state, o.total_amount::text as total_amount, o.currency
          from "order" o where ${theirOrders(tx)} order by o.placed_at desc limit ${recentOrdersShown}) r), '[]'::json) as recent_orders
      from customer c
      where c.id = ${id} and c.store_id = ${storeId} and c.status <> 'deleted'
    `
  )[0] ?? null

export interface CustomerToChangeRow {
  id: string
  name: string | null
  email: string | null
  phone: string | null
  phone_verified: boolean
  consent_state: ConsentState
  tags: string[]
}

export const lockStoreCustomer = async (tx: ScopedSql, storeId: string, id: string): Promise<CustomerToChangeRow | null> =>
  (
    await tx<CustomerToChangeRow[]>`
      select id, name, email, phone, phone_verified_at is not null as phone_verified, consent_state, to_json(tags) as tags from customer
      where id = ${id} and store_id = ${storeId} and status <> 'deleted' for update
    `
  )[0] ?? null

/** The customer this email or number already is, if any (including one a shopper deleted, which can't be added again). */
export const selectCustomerByContact = async (tx: ScopedSql, storeId: string, email: string | null, phone: string | null): Promise<{ id: string; status: string } | null> =>
  (
    await tx<{ id: string; status: string }[]>`
      select id, status from customer where store_id = ${storeId} and ((${email}::text is not null and email = ${email}) or (${phone}::text is not null and phone = ${phone}))
      order by (email = ${email}) desc nulls last limit 1
    `
  )[0] ?? null

/** Added by the team: no password and nothing proven, so the shopper takes it over by proving the email (ACCESS §2.1). */
export const insertStoreCustomer = async (tx: ScopedSql, c: { storeId: string; name: string; email: string; phone: string | null; byUserId: string; now: Date }): Promise<string | null> =>
  (
    await tx<{ id: string }[]>`
      insert into customer (store_id, email, phone, name, status, consent_source, added_by_user_id, created_at)
      values (${c.storeId}, ${c.email}, ${c.phone}, ${c.name}, 'unverified', 'added_by_hand', ${c.byUserId}, ${c.now})
      on conflict do nothing returning id
    `
  )[0]?.id ?? null

/**
 * A guest buyer as a customer, at placement and in system scope: unverified and without a password, keyed by the email
 * or, without one, the number; the order keeps no customer id, so only proving the email or number links an account.
 */
export const ensureGuestCustomer = async (tx: ScopedSql, c: { storeId: string; email: string | null; phone: string | null; name: string | null; now: Date }): Promise<void> => {
  if (!c.email && !c.phone) return
  await tx`
    insert into customer (store_id, email, phone, name, status, created_at)
    select ${c.storeId}, ${c.email}, ${c.email ? null : c.phone}, ${c.name}, 'unverified', ${c.now}
    where not exists (select 1 from customer where store_id = ${c.storeId} and ${c.email ? tx`email = ${c.email}` : tx`phone = ${c.phone}`})
    on conflict do nothing
  `
}

export const updateStoreCustomer = async (tx: ScopedSql, id: string, c: { name: string; phone: string | null }): Promise<void> => {
  await tx`update customer set name = ${c.name}, phone = ${c.phone} where id = ${id}`
}

/** The default delivery address, changed in place or added as the first. */
export const saveDefaultAddress = async (tx: ScopedSql, storeId: string, customerId: string, a: CartAddress): Promise<void> => {
  const [current] = await tx<{ id: string }[]>`
    select id from customer_address where customer_id = ${customerId} and store_id = ${storeId} and is_default_shipping and deleted_at is null for update
  `
  if (current) {
    await tx`
      update customer_address set name = ${a.name}, line1 = ${a.line1}, line2 = ${a.line2}, city = ${a.city}, region = ${a.region}, postal_code = ${a.postalCode},
        country = ${a.country}, phone = ${a.phone}
      where id = ${current.id}
    `
    return
  }
  await tx`
    insert into customer_address (customer_id, store_id, name, line1, line2, city, region, postal_code, country, phone, is_default_shipping)
    values (${customerId}, ${storeId}, ${a.name}, ${a.line1}, ${a.line2}, ${a.city}, ${a.region}, ${a.postalCode}, ${a.country}, ${a.phone}, true)
  `
}

export const setCustomerTags = async (tx: ScopedSql, id: string, tags: readonly string[]): Promise<void> => {
  await tx`update customer set tags = ${pgArray([...tags])}::text[] where id = ${id}`
}

export const setCustomerNote = async (tx: ScopedSql, id: string, note: string | null): Promise<void> => {
  await tx`update customer set note = ${note} where id = ${id}`
}

/** "Record that they asked to stop" (FIRST-RELEASE §7): no marketing on any channel; order emails still go. */
export const recordConsentStopped = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update customer set consent_state = 'stopped', consent_at = ${now}, consent_source = 'recorded_by_store', consent_channels = '{}' where id = ${id}`
}

export interface GroupRow {
  id: string
  name: string
  description: string | null
  members: number
  created_at: Date
}

/** Every live group, by name, with how many customers it holds. */
export const selectCustomerGroups = (tx: ScopedSql, storeId: string): Promise<GroupRow[]> =>
  tx<GroupRow[]>`
    select k.id, k.name, k.description, k.created_at,
      (select count(*)::int from customer_group_member m join customer c on c.id = m.customer_id and c.status <> 'deleted' where m.group_id = k.id) as members
    from customer_group k where k.store_id = ${storeId} and k.deleted_at is null
    order by lower(k.name), k.id
  `

export const countCustomerGroups = async (tx: ScopedSql, storeId: string): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from customer_group where store_id = ${storeId} and deleted_at is null`)[0]?.n ?? 0

export const lockCustomerGroup = async (tx: ScopedSql, storeId: string, id: string): Promise<{ id: string; name: string } | null> =>
  (await tx<{ id: string; name: string }[]>`select id, name from customer_group where id = ${id} and store_id = ${storeId} and deleted_at is null for update`)[0] ?? null

/** Another live group of the store already called this, whatever its case. */
export const groupNameTaken = async (tx: ScopedSql, storeId: string, name: string, except: string | null): Promise<boolean> =>
  (await tx`select 1 from customer_group where store_id = ${storeId} and lower(name) = lower(${name}) and deleted_at is null and id is distinct from ${except}::uuid`).length > 0

export const insertCustomerGroup = async (tx: ScopedSql, g: { storeId: string; name: string; description: string | null; now: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into customer_group (store_id, name, description, created_at) values (${g.storeId}, ${g.name}, ${g.description}, ${g.now}) returning id
  `
  if (!row) throw new Error('customer_group: insert returned no row')
  return row.id
}

export const updateCustomerGroup = async (tx: ScopedSql, id: string, g: { name: string; description: string | null }): Promise<void> => {
  await tx`update customer_group set name = ${g.name}, description = ${g.description} where id = ${id}`
}

/** Kept for history, its members let go. */
export const deleteCustomerGroup = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`delete from customer_group_member where group_id = ${id}`
  await tx`update customer_group set deleted_at = ${now} where id = ${id}`
}

/** Of these ids, the store's live groups. */
export const liveGroupIds = async (tx: ScopedSql, storeId: string, ids: readonly string[]): Promise<string[]> =>
  (await tx<{ id: string }[]>`select id from customer_group where store_id = ${storeId} and deleted_at is null and id = any (${pgArray([...ids])}::uuid[])`).map((r) => r.id)

/** The customer's groups become exactly these, in two statements. */
export const setCustomerGroups = async (tx: ScopedSql, storeId: string, customerId: string, groupIds: readonly string[]): Promise<void> => {
  const ids = pgArray([...groupIds])
  await tx`delete from customer_group_member where customer_id = ${customerId} and not (group_id = any (${ids}::uuid[]))`
  await tx`
    insert into customer_group_member (group_id, customer_id, store_id)
    select g, ${customerId}, ${storeId} from unnest(${ids}::uuid[]) as g
    on conflict do nothing
  `
}

export interface CustomerExportRow {
  name: string | null
  email: string | null
  phone: string | null
  city: string | null
  orders: number
  spent: { amount: string; currency: string }[]
  tags: string[]
  groups: string[]
  consent_state: ConsentState
}

/** The export's rows, newest first, the filter as the list's. */
export const selectCustomerExportRows = (tx: ScopedSql, storeId: string, f: CustomerFilter, limit: number): Promise<CustomerExportRow[]> =>
  tx<CustomerExportRow[]>`
    select ${listColumns(tx)}, c.consent_state,
      to_json(array(select k.name from customer_group_member g join customer_group k on k.id = g.group_id and k.deleted_at is null where g.customer_id = c.id order by k.name)) as groups
    from customer c
    where c.store_id = ${storeId} and ${matches(tx, f)}
    order by c.created_at desc, c.id desc
    limit ${limit}
  `
