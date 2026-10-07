import type { ScopedSql } from './index'

// Shopper identity (migration 0067; ACCESS §2.1): how a store signs its shoppers in, the codes that prove an email or a
// number, accounts and sessions. Read and written in system scope by auth/shopperAuth.ts, every query naming its store.

export interface CustomerAuthRow {
  email_enabled: boolean
  phone_enabled: boolean
}

/** Every store has its row (migration 0067); one missing signs nobody in rather than guess a way. */
export const selectCustomerAuth = async (tx: ScopedSql, storeId: string): Promise<CustomerAuthRow> =>
  (await tx<CustomerAuthRow[]>`select email_enabled, phone_enabled from store_customer_auth where store_id = ${storeId}`)[0] ?? { email_enabled: false, phone_enabled: false }

/** Codes asked for this email or number since a moment: what the per-address limit counts. */
export const countRecentCodes = async (tx: ScopedSql, storeId: string, by: { channel: string; target: string }, since: Date): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from customer_code where store_id = ${storeId} and created_at > ${since} and channel = ${by.channel} and target = ${by.target}`)[0]?.n ?? 0

export const insertCode = async (tx: ScopedSql, c: { storeId: string; channel: 'email' | 'phone'; target: string; codeHash: string | null; expiresAt: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into customer_code (store_id, channel, target, code_hash, expires_at) values (${c.storeId}, ${c.channel}, ${c.target}, ${c.codeHash}, ${c.expiresAt}) returning id
  `
  if (!row) throw new Error('customer_code: insert returned no row')
  return row.id
}

/** An emailed code is made when the email goes (saas/email), so none rests in the outbox; false once it can't be used. */
export const setCodeHash = async (tx: ScopedSql, id: string, codeHash: string, expiresAt: Date, now: Date): Promise<boolean> =>
  (await tx`update customer_code set code_hash = ${codeHash}, expires_at = ${expiresAt} where id = ${id} and used_at is null and expires_at > ${now}`).count > 0

export interface CodeForEmailRow {
  id: string
  store_id: string
  partner_id: string
  store_name: string
  target: string
}

export const selectCodeForEmail = async (tx: ScopedSql, id: string, now: Date): Promise<CodeForEmailRow | null> =>
  (
    await tx<CodeForEmailRow[]>`
      select c.id, c.store_id, s.partner_id, s.name as store_name, c.target from customer_code c join store s on s.id = c.store_id
      where c.id = ${id} and c.channel = 'email' and c.used_at is null and c.expires_at > ${now}
    `
  )[0] ?? null

export interface CodeRow {
  id: string
  code_hash: string | null
  attempts: number
}

/** The newest live code for this email or number, locked, so two tries can't both spend one attempt. */
export const selectLiveCode = async (tx: ScopedSql, storeId: string, channel: string, target: string, now: Date): Promise<CodeRow | null> =>
  (
    await tx<CodeRow[]>`
      select id, code_hash, attempts from customer_code
      where store_id = ${storeId} and channel = ${channel} and target = ${target} and used_at is null and expires_at > ${now}
      order by created_at desc limit 1 for update
    `
  )[0] ?? null

export const countCodeAttempt = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`update customer_code set attempts = attempts + 1 where id = ${id}`
}

export const spendCode = async (tx: ScopedSql, id: string, now: Date): Promise<void> => {
  await tx`update customer_code set used_at = ${now} where id = ${id}`
}

export interface ShopperRow {
  id: string
  email: string | null
  phone: string | null
  name: string | null
  password_hash: string | null
  status: 'active' | 'unverified' | 'deleted'
}

export const selectShopperBy = async (tx: ScopedSql, storeId: string, channel: 'email' | 'phone', target: string): Promise<ShopperRow | null> =>
  (
    await tx<ShopperRow[]>`
      select id, email, phone, name, password_hash, status from customer
      where store_id = ${storeId} and ${channel === 'email' ? tx`email = ${target}` : tx`phone = ${target}`}
    `
  )[0] ?? null

export const insertShopper = async (tx: ScopedSql, c: { storeId: string; channel: 'email' | 'phone'; target: string; name: string | null; passwordHash: string | null; now: Date }): Promise<string> => {
  const [row] = await tx<{ id: string }[]>`
    insert into customer (store_id, email, email_verified_at, phone, phone_verified_at, name, password_hash, status)
    values (${c.storeId}, ${c.channel === 'email' ? c.target : null}, ${c.channel === 'email' ? c.now : null},
      ${c.channel === 'phone' ? c.target : null}, ${c.channel === 'phone' ? c.now : null}, ${c.name}, ${c.passwordHash}, 'active')
    returning id
  `
  if (!row) throw new Error('customer: insert returned no row')
  return row.id
}

/** The proven email or number marked verified; an unverified account becomes active; a password set when one is given. */
export const proveShopper = async (tx: ScopedSql, id: string, channel: 'email' | 'phone', passwordHash: string | null, now: Date): Promise<void> => {
  await tx`
    update customer set
      email_verified_at = ${channel === 'email' ? tx`coalesce(email_verified_at, ${now})` : tx`email_verified_at`},
      phone_verified_at = ${channel === 'phone' ? tx`coalesce(phone_verified_at, ${now})` : tx`phone_verified_at`},
      password_hash = ${passwordHash ?? tx`password_hash`},
      status = case when status = 'unverified' then 'active' else status end
    where id = ${id}
  `
}

export const insertShopperSession = async (tx: ScopedSql, s: { idHash: string; storeId: string; customerId: string; expiresAt: Date; now: Date }): Promise<void> => {
  await tx`insert into customer_session (id_hash, store_id, customer_id, created_at, last_seen_at, expires_at) values (${s.idHash}, ${s.storeId}, ${s.customerId}, ${s.now}, ${s.now}, ${s.expiresAt})`
}

/** A live session of an active shopper of this store, moved on 30 days from now. */
export const touchShopperSession = async (tx: ScopedSql, idHash: string, storeId: string, now: Date, expiresAt: Date): Promise<string | null> =>
  (
    await tx<{ customer_id: string }[]>`
      update customer_session s set last_seen_at = ${now}, expires_at = ${expiresAt}
      from customer c
      where s.id_hash = ${idHash} and s.store_id = ${storeId} and s.ended_at is null and s.expires_at > ${now}
        and c.id = s.customer_id and c.store_id = ${storeId} and c.status = 'active'
      returning s.customer_id
    `
  )[0]?.customer_id ?? null

export const endShopperSessions = async (tx: ScopedSql, customerId: string, storeId: string, now: Date): Promise<void> => {
  await tx`update customer_session set ended_at = ${now} where customer_id = ${customerId} and store_id = ${storeId} and ended_at is null`
}

/**
 * The cron's sweep: codes a day past their expiry, which hold an email or number that may be no customer's, and
 * sessions ended or expired 30 days ago (#444's review).
 */
export const purgeShopperIdentity = async (tx: ScopedSql, now: Date, limit: number): Promise<number> => {
  const codes = await tx`delete from customer_code where id in (select id from customer_code where expires_at < ${new Date(now.getTime() - 86_400_000)} limit ${limit})`
  const sessions = await tx`
    delete from customer_session where id_hash in (select id_hash from customer_session
      where coalesce(ended_at, expires_at) < ${new Date(now.getTime() - 30 * 86_400_000)} limit ${limit})
  `
  return codes.count + sessions.count
}

export const endShopperSession = async (tx: ScopedSql, idHash: string, storeId: string, now: Date): Promise<string | null> =>
  (await tx<{ customer_id: string }[]>`update customer_session set ended_at = ${now} where id_hash = ${idHash} and store_id = ${storeId} and ended_at is null returning customer_id`)[0]?.customer_id ?? null

export interface AccountCountsRow {
  customers: number
  with_email: number
  with_phone: number
  phone_only: number
}

/** Settings › Customer accounts' line: accounts, with an email, with a number, and those a switch to email-only would ask. */
export const countAccounts = async (tx: ScopedSql, storeId: string): Promise<AccountCountsRow> =>
  (
    await tx<AccountCountsRow[]>`
      select count(*)::int as customers, count(email)::int as with_email, count(phone)::int as with_phone,
        count(*) filter (where phone is not null and email is null)::int as phone_only
      from customer where store_id = ${storeId} and status <> 'deleted'
    `
  )[0] ?? { customers: 0, with_email: 0, with_phone: 0, phone_only: 0 }

export const saveCustomerAuth = async (tx: ScopedSql, storeId: string, mode: { email: boolean; phone: boolean }, now: Date): Promise<void> => {
  await tx`
    insert into store_customer_auth (store_id, email_enabled, phone_enabled, updated_at) values (${storeId}, ${mode.email}, ${mode.phone}, ${now})
    on conflict (store_id) do update set email_enabled = excluded.email_enabled, phone_enabled = excluded.phone_enabled, updated_at = excluded.updated_at,
      revision = store_customer_auth.revision + 1
  `
}

export interface AddressRow {
  id: string
  name: string
  line1: string
  line2: string | null
  city: string
  region: string | null
  postal_code: string | null
  country: string
  phone: string | null
  is_default_shipping: boolean
}

export const maxAddresses = 20

export const selectAddresses = (tx: ScopedSql, customerId: string): Promise<AddressRow[]> =>
  tx<AddressRow[]>`
    select id, name, line1, line2, city, region, postal_code, country, phone, is_default_shipping from customer_address
    where customer_id = ${customerId} and deleted_at is null order by is_default_shipping desc, created_at, id limit ${maxAddresses}
  `

export interface AddressWrite {
  name: string
  line1: string
  line2: string | null
  city: string
  region: string | null
  postalCode: string | null
  country: string
  phone: string | null
  isDefault: boolean
}

export const saveAddress = async (tx: ScopedSql, storeId: string, customerId: string, id: string | null, a: AddressWrite): Promise<string | null> => {
  if (a.isDefault) await tx`update customer_address set is_default_shipping = false where customer_id = ${customerId} and is_default_shipping and deleted_at is null`
  if (id === null) {
    const [row] = await tx<{ id: string }[]>`
      insert into customer_address (customer_id, store_id, name, line1, line2, city, region, postal_code, country, phone, is_default_shipping)
      values (${customerId}, ${storeId}, ${a.name}, ${a.line1}, ${a.line2}, ${a.city}, ${a.region}, ${a.postalCode}, ${a.country}, ${a.phone}, ${a.isDefault})
      returning id
    `
    return row?.id ?? null
  }
  const done = await tx`
    update customer_address set name = ${a.name}, line1 = ${a.line1}, line2 = ${a.line2}, city = ${a.city}, region = ${a.region},
      postal_code = ${a.postalCode}, country = ${a.country}, phone = ${a.phone}, is_default_shipping = ${a.isDefault}
    where id = ${id} and customer_id = ${customerId} and deleted_at is null
  `
  return done.count > 0 ? id : null
}

export const removeAddress = async (tx: ScopedSql, customerId: string, id: string, now: Date): Promise<boolean> =>
  (await tx`update customer_address set deleted_at = ${now}, is_default_shipping = false where id = ${id} and customer_id = ${customerId} and deleted_at is null`).count > 0

export const selectAccount = async (tx: ScopedSql, customerId: string): Promise<{ id: string; name: string | null; email: string | null; phone: string | null; email_verified_at: Date | null; phone_verified_at: Date | null } | null> =>
  (await tx<{ id: string; name: string | null; email: string | null; phone: string | null; email_verified_at: Date | null; phone_verified_at: Date | null }[]>`
    select id, name, email, phone, email_verified_at, phone_verified_at from customer where id = ${customerId}
  `)[0] ?? null

export const renameShopper = async (tx: ScopedSql, customerId: string, name: string | null): Promise<boolean> =>
  (await tx`update customer set name = ${name} where id = ${customerId}`).count > 0

export const selectStoreName = async (tx: ScopedSql, storeId: string): Promise<string | null> =>
  (await tx<{ name: string }[]>`select name from store where id = ${storeId}`)[0]?.name ?? null

/** A number just proved by a code claims the store's guest orders placed with it (#337), never anyone else's. */
export const linkGuestOrders = async (tx: ScopedSql, storeId: string, customerId: string, phone: string, now: Date): Promise<number> =>
  (await tx`update "order" set customer_id = ${customerId}, updated_at = ${now} where store_id = ${storeId} and customer_id is null and phone = ${phone} and state <> 'cart'`).count
