import { likePattern } from './stores'
import type { ScopedSql } from './index'

// The people a partner may follow in its Activity log (ui/platform/FIRST-RELEASE.md §13): its
// own team and its merchants' Owners, never a shopper, a supplier or DripFunnel staff.

export interface ActivityPerson {
  kind: 'team' | 'owner'
  id: string
  name: string
  detail: string
}

export const selectActivityPeople = (tx: ScopedSql, partnerId: string, term: string, limit: number): Promise<ActivityPerson[]> => {
  const like = likePattern(term)
  return tx<ActivityPerson[]>`
    (select 'team' as kind, u.id, u.name, u.role_key as detail from partner_user u
      where u.partner_id = ${partnerId} and (u.name ilike ${like} or u.email ilike ${like})
      order by u.name limit ${limit})
    union all
    (select 'owner', p.id, p.name, s.name from membership m
      join "user" p on p.id = m.user_id join store s on s.id = m.store_id
      where s.partner_id = ${partnerId} and m.seller_id is null and m.role_key = 'owner' and (p.name ilike ${like} or p.email ilike ${like})
      order by p.name limit ${limit})
    order by name, kind
    limit ${limit}
  `
}

/** Whether the person is one the partner may follow: its team member or one of its merchants' Owners. */
export const personInScope = async (tx: ScopedSql, partnerId: string, kind: 'team' | 'owner', id: string): Promise<boolean> =>
  kind === 'team'
    ? (await tx`select 1 from partner_user where id = ${id} and partner_id = ${partnerId}`).length > 0
    : (await tx`select 1 from membership m join store s on s.id = m.store_id where m.user_id = ${id} and s.partner_id = ${partnerId} and m.seller_id is null and m.role_key = 'owner'`).length > 0
