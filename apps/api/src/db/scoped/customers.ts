import type { KeysetPage } from './activity'
import { maxPageSize, type ScopedSql } from './index'

// Shoppers' accounts for the admin console (ui/admin/FIRST-RELEASE.md §5.4; card #36): never an
// address, an order or a password; the Admin API masks email and phone (§5.4).

export type CustomerSearch = { kind: 'name'; term: string } | { kind: 'email'; email: string } | { kind: 'phone'; digits: string }
export type SignInMethod = 'email' | 'mobile' | 'both'

export interface CustomerFilter {
  partnerId?: string | undefined
  storeId?: string | undefined
  status?: 'active' | 'unverified' | 'deleted' | undefined
  method?: SignInMethod | undefined
  createdAfter?: Date | undefined
  signedInAfter?: Date | undefined
  /** A Partner manager reads its assigned partners' stores only (ACCESS.md §5.4). */
  assignedTo?: string | undefined
  search?: CustomerSearch | undefined
}

export interface CustomerRow {
  id: string
  store_id: string
  store_name: string
  partner_id: string
  partner_name: string
  name: string | null
  email: string | null
  phone: string | null
  phone_country_code: string | null
  email_verified_at: Date | null
  phone_verified_at: Date | null
  status: 'active' | 'unverified' | 'deleted'
  created_at: Date
  last_sign_in_at: Date | null
  store_suspended: boolean
  store_suspended_reason: string | null
}

const columns = (tx: ScopedSql) => tx`
  c.id, c.store_id, s.name as store_name, s.partner_id, p.name as partner_name, c.name, c.email, c.phone, c.phone_country_code,
  c.email_verified_at, c.phone_verified_at, c.status, c.created_at, c.last_sign_in_at,
  s.suspended_at is not null as store_suspended, s.suspended_reason as store_suspended_reason
`

const where = (tx: ScopedSql, f: CustomerFilter) => tx`
  ${f.partnerId !== undefined ? tx`and s.partner_id = ${f.partnerId}` : tx``}
  ${f.storeId !== undefined ? tx`and c.store_id = ${f.storeId}` : tx``}
  ${f.status !== undefined ? tx`and c.status = ${f.status}` : tx``}
  ${f.method === 'email' ? tx`and c.email is not null and c.phone is null` : tx``}
  ${f.method === 'mobile' ? tx`and c.phone is not null and c.email is null` : tx``}
  ${f.method === 'both' ? tx`and c.email is not null and c.phone is not null` : tx``}
  ${f.createdAfter !== undefined ? tx`and c.created_at >= ${f.createdAfter}` : tx``}
  ${f.signedInAfter !== undefined ? tx`and c.last_sign_in_at >= ${f.signedInAfter}` : tx``}
  ${f.assignedTo !== undefined ? tx`and s.partner_id in (select partner_id from staff_partner_assignment a where a.staff_user_id = ${f.assignedTo} and a.removed_at is null)` : tx``}
  ${f.search?.kind === 'name' ? tx`and c.name ilike ${`%${f.search.term.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`}` : tx``}
  ${f.search?.kind === 'email' ? tx`and lower(c.email) = lower(${f.search.email})` : tx``}
  ${f.search?.kind === 'phone' ? tx`and (c.phone_digits = ${f.search.digits} or c.phone_national = ${f.search.digits})` : tx``}
`

/** Newest first by (created_at, id), one more row than asked; `before` reads backwards and is flipped. */
export const selectCustomers = async (tx: ScopedSql, f: CustomerFilter, page: KeysetPage, limit: number): Promise<CustomerRow[]> => {
  const backwards = page.before !== undefined
  const key = tx`c.created_at`
  const rows = await tx<CustomerRow[]>`
    select ${columns(tx)} from customer c join store s on s.id = c.store_id join partner p on p.id = s.partner_id
    where true ${where(tx, f)}
      ${page.after !== undefined ? tx`and (${key}, c.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and (${key}, c.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by ${key} asc, c.id asc` : tx`order by ${key} desc, c.id desc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

/** For an exact search: how many accounts matched over every page, and the phones' calling codes. */
export const countCustomerMatches = async (tx: ScopedSql, f: CustomerFilter): Promise<{ accounts: number; codes: string[] }> => {
  const [row] = await tx<{ accounts: number; codes: string[] }[]>`
    select count(*)::int as accounts, coalesce(to_json(array_agg(distinct c.phone_country_code) filter (where c.phone_country_code is not null)), '[]'::json) as codes
    from customer c join store s on s.id = c.store_id where true ${where(tx, f)}
  `
  return row ?? { accounts: 0, codes: [] }
}

export const selectCustomer = async (tx: ScopedSql, id: string, assignedTo: string | undefined): Promise<CustomerRow | null> =>
  (
    await tx<CustomerRow[]>`
      select ${columns(tx)} from customer c join store s on s.id = c.store_id join partner p on p.id = s.partner_id
      where c.id = ${id} ${where(tx, { assignedTo })}
    `
  )[0] ?? null

/** The Store filter's choices once a partner is chosen (§5.4), capped like every list. */
export const selectStoreChoices = (tx: ScopedSql, partnerId: string, assignedTo: string | undefined): Promise<{ id: string; name: string }[]> =>
  tx<{ id: string; name: string }[]>`
    select s.id, s.name from store s where s.partner_id = ${partnerId} ${where(tx, { assignedTo })}
    order by s.name, s.id limit ${maxPageSize}
  `
