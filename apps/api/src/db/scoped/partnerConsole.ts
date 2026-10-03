import type { ProvisioningStep, StoreStatus } from '../schema/saas'
import type { ScopedSql } from './index'
import { likePattern, stuckJobPredicate } from './stores'

// The partner console's shell (ui/platform/FIRST-RELEASE.md §2): every query names the
// caller's partner as well as running under its RLS scope (DATA-MODEL §5).

export interface StoreSearchRow {
  id: string
  name: string
  code: string
  status: StoreStatus
  domain: string | null
  owner_email: string | null
}

/** §2.2: name, code, domain or owner email, over this partner's stores only. */
export const searchPartnerStores = (tx: ScopedSql, partnerId: string, term: string, limit: number): Promise<StoreSearchRow[]> => {
  const q = likePattern(term)
  return tx<StoreSearchRow[]>`
    select s.id, s.name, s.code, s.status, d.host as domain, o.email as owner_email
    from store s
    left join lateral (select host from custom_domain where store_id = s.id order by created_at desc limit 1) d on true
    left join lateral (
      select u.email from membership m join "user" u on u.id = m.user_id
      where m.store_id = s.id and m.seller_id is null and m.role_key = 'owner' limit 1
    ) o on true
    where s.partner_id = ${partnerId}
      and (s.name ilike ${q} or s.code ilike ${q} or d.host ilike ${q} or o.email ilike ${q})
    order by s.name, s.id
    limit ${limit}
  `
}

export interface NavCounts {
  stores_attention: number
  branding_left: number
  domains_waiting: number
}

/** §2.1's badges that have data today; each an indexed, partner-scoped count. */
export const selectNavCounts = async (tx: ScopedSql, partnerId: string, stuckAfterMinutes: Readonly<Record<ProvisioningStep, number>>, now: Date): Promise<NavCounts> => {
  const stuck = stuckJobPredicate(tx, stuckAfterMinutes, now)
  const [row] = await tx<NavCounts[]>`
    -- A store's latest domain only; stuck is failed, broken, or waiting for DNS over 24 h (§6.1).
    with stuck_domains as (
      select count(*)::int as n from store s
      join lateral (select status, created_at from custom_domain where store_id = s.id order by created_at desc limit 1) d on true
      where s.partner_id = ${partnerId}
        and (d.status in ('failed', 'broken') or (d.status = 'waiting' and d.created_at < ${now}::timestamptz - interval '24 hours'))
    )
    select
      (select count(*)::int from store s join job j on j.store_id = s.id
        where s.partner_id = ${partnerId} and j.state <> 'done' and (j.state = 'failed' or ${stuck}))
        + (select n from stuck_domains) as stores_attention,
      (select count(*)::int from partner_setup_item i join partner p on p.id = i.partner_id
        where i.partner_id = ${partnerId} and p.approved_at is null and i.item in ('branding', 'legal') and i.status <> 'done') as branding_left,
      (select count(*)::int from partner_domain where partner_id = ${partnerId} and status in ('waiting', 'verifying', 'issuing', 'failed', 'broken'))
        + (select n from stuck_domains) as domains_waiting
  `
  return row ?? { stores_attention: 0, branding_left: 0, domains_waiting: 0 }
}

export interface ShellFacts {
  store_count: number
  broken_hosts: string[]
}

export const selectShellFacts = async (tx: ScopedSql, partnerId: string): Promise<ShellFacts> => {
  const [row] = await tx<{ store_count: number; broken_hosts: string[] | null }[]>`
    select
      (select count(*)::int from store where partner_id = ${partnerId} and status <> 'closed') as store_count,
      (select to_jsonb(array_agg(host order by kind)) from partner_domain
        where partner_id = ${partnerId} and kind in ('portal', 'email') and status = 'broken') as broken_hosts
  `
  return { store_count: row?.store_count ?? 0, broken_hosts: row?.broken_hosts ?? [] }
}

/** The staff setup session open on this partner now (ACCESS.md §8.2); read in system scope. */
export const selectOpenSetupSessionOn = async (tx: ScopedSql, partnerId: string, now: Date): Promise<{ staff_name: string; expires_at: Date } | null> => {
  const [row] = await tx<{ staff_name: string; expires_at: Date }[]>`
    select u.name as staff_name, s.expires_at from partner_setup_session s join staff_user u on u.id = s.staff_user_id
    where s.partner_id = ${partnerId} and s.ended_at is null and s.expires_at > ${now}
    order by s.started_at desc limit 1
  `
  return row ?? null
}
