import { maxPageSize, pgArray, type ScopedSql } from './index'
import { likePattern } from './stores'

// What the admin console's Activity log reads beside the entries (ui/admin/FIRST-RELEASE.md §9;
// card #38): the names on a page, the filters' choices, and the people a staff member may follow.

export type PersonKind = 'staff' | 'partner_user' | 'person' | 'customer'

const assigned = (tx: ScopedSql, column: ReturnType<ScopedSql>, assignedTo: string | undefined) =>
  assignedTo !== undefined ? tx`and ${column} in (select partner_id from staff_partner_assignment a where a.staff_user_id = ${assignedTo} and a.removed_at is null)` : tx``

/** The partners' and stores' names a page of entries names, in two queries (no N+1). */
export const selectEntryNames = async (tx: ScopedSql, partnerIds: readonly string[], storeIds: readonly string[]): Promise<{ partners: Map<string, string>; stores: Map<string, string> }> => {
  const partners = partnerIds.length ? await tx<{ id: string; name: string }[]>`select id, name from partner where id = any(${pgArray(partnerIds)}::uuid[])` : []
  const stores = storeIds.length ? await tx<{ id: string; name: string }[]>`select id, name from store where id = any(${pgArray(storeIds)}::uuid[])` : []
  return { partners: new Map(partners.map((p) => [p.id, p.name])), stores: new Map(stores.map((s) => [s.id, s.name])) }
}

/** The Store filter's choices, within a Partner manager's assignment, capped like every list. */
export const selectStoreOptions = (tx: ScopedSql, assignedTo: string | undefined): Promise<{ id: string; name: string; partner_id: string }[]> =>
  tx<{ id: string; name: string; partner_id: string }[]>`
    select id, name, partner_id from store where true ${assigned(tx, tx`partner_id`, assignedTo)} order by name, id limit ${maxPageSize}
  `

export interface PersonMatchRow {
  kind: PersonKind
  id: string
  name: string
  email: string
  where_label: string
}

/**
 * Up to `limit` people by name or email: staff, partner users and merchant or supplier people by
 * either; a shopper by name or exact email only, so the finder can't spell out shoppers' addresses.
 */
export const selectPeople = (tx: ScopedSql, term: string, limit: number, assignedTo: string | undefined): Promise<PersonMatchRow[]> => {
  const like = likePattern(term)
  return tx<PersonMatchRow[]>`
    select * from (
      (select 'staff' as kind, s.id, s.name, s.email, 'DripFunnel' as where_label from staff_user s
        where s.name ilike ${like} or s.email ilike ${like} order by s.name limit ${limit})
      union all
      (select 'partner_user', u.id, u.name, u.email, p.name from partner_user u join partner p on p.id = u.partner_id
        where (u.name ilike ${like} or u.email ilike ${like}) ${assigned(tx, tx`u.partner_id`, assignedTo)} order by u.name limit ${limit})
      union all
      (select 'person', u.id, u.name, u.email, p.name from "user" u join partner p on p.id = u.partner_id
        where u.status <> 'deleted' and (u.name ilike ${like} or u.email ilike ${like}) ${assigned(tx, tx`u.partner_id`, assignedTo)} order by u.name limit ${limit})
      union all
      (select 'customer', c.id, c.name, c.email, st.name from customer c join store st on st.id = c.store_id
        where c.status <> 'deleted' and (c.name ilike ${like} or lower(c.email) = lower(${term})) ${assigned(tx, tx`st.partner_id`, assignedTo)} order by c.name limit ${limit})
    ) people order by name, kind limit ${limit}
  `
}

export interface PersonRow {
  kind: PersonKind
  id: string
  name: string
  email: string | null
  where_label: string
  partner_id: string | null
}

export const selectPerson = async (tx: ScopedSql, kind: PersonKind, id: string): Promise<PersonRow | null> => {
  const rows =
    kind === 'staff'
      ? await tx<PersonRow[]>`select 'staff' as kind, id, name, email, 'DripFunnel' as where_label, null::uuid as partner_id from staff_user where id = ${id}`
      : kind === 'partner_user'
        ? await tx<PersonRow[]>`select 'partner_user' as kind, u.id, u.name, u.email, p.name as where_label, u.partner_id from partner_user u join partner p on p.id = u.partner_id where u.id = ${id}`
        : kind === 'person'
          ? await tx<PersonRow[]>`select 'person' as kind, u.id, u.name, u.email, p.name as where_label, u.partner_id from "user" u join partner p on p.id = u.partner_id where u.id = ${id} and u.status <> 'deleted'`
          : await tx<PersonRow[]>`select 'customer' as kind, c.id, coalesce(c.name, '') as name, c.email, st.name as where_label, st.partner_id from customer c join store st on st.id = c.store_id where c.id = ${id} and c.status <> 'deleted'`
  return rows[0] ?? null
}

/** Where a person works and as what: a partner user's role, a merchant or supplier person's stores. */
export const selectMemberships = (tx: ScopedSql, kind: PersonKind, id: string): Promise<{ where_label: string; role: string }[]> =>
  kind === 'partner_user'
    ? tx<{ where_label: string; role: string }[]>`select p.name as where_label, u.role_key as role from partner_user u join partner p on p.id = u.partner_id where u.id = ${id}`
    : kind === 'person'
      ? tx<{ where_label: string; role: string }[]>`
          select coalesce(sl.name || ' in ' || s.name, s.name) as where_label, m.role_key as role
          from membership m join store s on s.id = m.store_id left join seller sl on sl.id = m.seller_id
          where m.user_id = ${id} order by s.name limit ${maxPageSize}`
      : kind === 'staff'
        ? tx<{ where_label: string; role: string }[]>`select 'DripFunnel' as where_label, role_key as role from staff_user where id = ${id}`
        : tx<{ where_label: string; role: string }[]>`select st.name as where_label, 'customer' as role from customer c join store st on st.id = c.store_id where c.id = ${id}`

/** How many other accounts, of any kind, use this email: a pointer, never merged (LOGGING §6); within an assignment, only its partners'. */
export const countSameEmail = async (tx: ScopedSql, email: string, assignedTo: string | undefined): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select greatest(0, (select count(*) from staff_user where lower(email) = lower(${email}))
        + (select count(*) from partner_user u where lower(u.email) = lower(${email}) ${assigned(tx, tx`u.partner_id`, assignedTo)})
        + (select count(*) from "user" u where lower(u.email) = lower(${email}) and u.status <> 'deleted' ${assigned(tx, tx`u.partner_id`, assignedTo)})
        + (select count(*) from customer c join store st on st.id = c.store_id where lower(c.email) = lower(${email}) and c.status <> 'deleted' ${assigned(tx, tx`st.partner_id`, assignedTo)})
        - 1)::int as n
    `
  )[0]?.n ?? 0

export const isAssignedPartner = async (tx: ScopedSql, staffId: string, partnerId: string): Promise<boolean> =>
  (await tx`select 1 from staff_partner_assignment where staff_user_id = ${staffId} and partner_id = ${partnerId} and removed_at is null`).length > 0
