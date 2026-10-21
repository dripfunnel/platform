import type { PartnerState, ProvisioningStep } from '../schema/saas'
import { maxPageSize, type ScopedSql } from './index'
import { likePattern, stuckJobPredicate } from './stores'

// The Dashboard's and the header's aggregates (ui/admin/FIRST-RELEASE.md §2, §3): one round
// trip per card, counted in SQL over the indexes of 0007, never in a loop.

export interface DashboardScope {
  /** One partner, or every partner the caller sees. */
  partnerId?: string | undefined
  /** A Partner manager counts their assigned partners only (ACCESS.md §5.4). */
  assignedTo?: string | undefined
}

const partnerWhere = (tx: ScopedSql, scope: DashboardScope, column = 'id') => tx`
  ${scope.partnerId !== undefined ? tx`and ${tx(column)} = ${scope.partnerId}` : tx``}
  ${scope.assignedTo !== undefined ? tx`and ${tx(column)} in (select partner_id from staff_partner_assignment a where a.staff_user_id = ${scope.assignedTo} and a.removed_at is null)` : tx``}
`

export const selectVisiblePartner = async (tx: ScopedSql, id: string, assignedTo: string | undefined): Promise<{ id: string; name: string } | null> =>
  (await tx<{ id: string; name: string }[]>`select id, name from partner where id = ${id} ${partnerWhere(tx, { assignedTo })}`)[0] ?? null

export const countPartnersByState = async (tx: ScopedSql, scope: DashboardScope): Promise<Record<PartnerState, number>> => {
  const rows = await tx<{ state: PartnerState; n: number }[]>`
    select state, count(*)::int as n from partner where true ${partnerWhere(tx, scope)} group by state
  `
  const counts: Record<PartnerState, number> = { draft: 0, awaiting: 0, live: 0, paused: 0, offboarding: 0, closed: 0 }
  for (const row of rows) counts[row.state] = row.n
  return counts
}

export const countAwaitingPartners = async (tx: ScopedSql, scope: DashboardScope): Promise<number> =>
  (await tx<{ n: number }[]>`select count(*)::int as n from partner where state = 'awaiting' ${partnerWhere(tx, scope)}`)[0]?.n ?? 0

export const selectOldestAwaiting = async (tx: ScopedSql, scope: DashboardScope): Promise<{ id: string; name: string; submitted_at: Date } | null> =>
  (
    await tx<{ id: string; name: string; submitted_at: Date }[]>`
      select id, name, submitted_at from partner
      where state = 'awaiting' and submitted_at is not null ${partnerWhere(tx, scope)}
      order by submitted_at asc limit 1
    `
  )[0] ?? null

export const countStores = async (tx: ScopedSql, scope: DashboardScope, since: Date): Promise<{ total: number; new_since: number }> =>
  (
    await tx<{ total: number; new_since: number }[]>`
      select count(*)::int as total, count(*) filter (where created_at >= ${since})::int as new_since
      from store s where true ${partnerWhere(tx, scope, 'partner_id')}
    `
  )[0] ?? { total: 0, new_since: 0 }

/** The partners with the most new stores since `since`, largest first, capped (FIRST-RELEASE §3). */
export const countNewStoresByPartner = (tx: ScopedSql, scope: DashboardScope, since: Date, limit: number): Promise<{ id: string; name: string; count: number }[]> =>
  tx<{ id: string; name: string; count: number }[]>`
    select p.id, p.name, count(s.id)::int as count
    from store s join partner p on p.id = s.partner_id
    where s.created_at >= ${since} ${partnerWhere(tx, scope, 's.partner_id')}
    group by p.id, p.name order by count desc, p.name limit ${Math.min(limit, maxPageSize)}
  `

const latestJob = (tx: ScopedSql) => tx`left join lateral (select * from job where store_id = s.id order by started_at desc limit 1) j on true`

export interface AttentionCounts {
  past_due: number
  suspended: number
  setup_failed: number
  setup_stuck: number
  total: number
}

export interface AttentionRow {
  id: string
  name: string
  partner_name: string
  status: string
  past_due_since: Date | null
  suspended_reason: string | null
  job_state: string | null
  job_step: ProvisioningStep | null
  job_attempts: number | null
  stuck: boolean
}

const noAttention: AttentionCounts = { past_due: 0, suspended: 0, setup_failed: 0, setup_stuck: 0, total: 0 }

/**
 * The Needs attention card in one statement: the counts over every matching store (a store
 * counts once in `total`, whatever it needs) and the most urgent few, failed setups first.
 */
export const selectAttention = async (
  tx: ScopedSql,
  scope: DashboardScope,
  stuckAfterMinutes: Readonly<Record<ProvisioningStep, number>>,
  now: Date,
  limit: number,
): Promise<{ counts: AttentionCounts; rows: AttentionRow[] }> => {
  const stuck = stuckJobPredicate(tx, stuckAfterMinutes, now)
  const rows = await tx<(AttentionRow & AttentionCounts)[]>`
    select s.id, s.name, p.name as partner_name, s.status, s.past_due_since, s.suspended_reason,
      j.state as job_state, j.step as job_step, j.attempts as job_attempts, ${stuck} as stuck,
      count(*) filter (where s.status = 'past_due') over ()::int as past_due,
      count(*) filter (where s.status = 'suspended') over ()::int as suspended,
      count(*) filter (where j.state = 'failed') over ()::int as setup_failed,
      count(*) filter (where ${stuck}) over ()::int as setup_stuck,
      count(*) over ()::int as total
    from store s join partner p on p.id = s.partner_id ${latestJob(tx)}
    where (s.status in ('past_due', 'suspended') or j.state = 'failed' or ${stuck})
      ${partnerWhere(tx, scope, 's.partner_id')}
    order by
      case when j.state = 'failed' then 0 when ${stuck} then 1 when s.status = 'suspended' then 2 else 3 end,
      s.past_due_since asc nulls last, s.created_at desc
    limit ${Math.min(limit, maxPageSize)}
  `
  const first = rows[0]
  const counts: AttentionCounts = first ? { past_due: first.past_due, suspended: first.suspended, setup_failed: first.setup_failed, setup_stuck: first.setup_stuck, total: first.total } : noAttention
  return { counts, rows }
}

/** Failed or stuck signups, read from the unfinished jobs (job_state_idx) rather than every store. */
export const countSetupAttention = async (tx: ScopedSql, scope: DashboardScope, stuckAfterMinutes: Readonly<Record<ProvisioningStep, number>>, now: Date): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n
      from job j join store s on s.id = j.store_id
      where j.state in ('running', 'failed')
        and (j.state = 'failed' or ${stuckJobPredicate(tx, stuckAfterMinutes, now)})
        and not exists (select 1 from job later where later.store_id = j.store_id and later.started_at > j.started_at)
        ${partnerWhere(tx, scope, 's.partner_id')}
    `
  )[0]?.n ?? 0

export interface SignupCounts {
  started: number
  completed: number
  failed: number
  median_seconds: number | null
}

/**
 * Three event counts in the window (FIRST-RELEASE §3): jobs started, jobs finished well and
 * jobs that failed (at `finished_at`, or the failing step's start when the job never closed).
 */
export const countSignups = async (tx: ScopedSql, scope: DashboardScope, since: Date): Promise<SignupCounts> =>
  (
    await tx<SignupCounts[]>`
      select
        count(*) filter (where j.started_at >= ${since})::int as started,
        count(*) filter (where j.state = 'done' and j.finished_at >= ${since})::int as completed,
        count(*) filter (where j.state = 'failed' and coalesce(j.finished_at, j.step_started_at) >= ${since})::int as failed,
        percentile_cont(0.5) within group (order by extract(epoch from (j.finished_at - j.started_at)))
          filter (where j.state = 'done' and j.finished_at >= ${since}) as median_seconds
      from job j join store s on s.id = j.store_id
      where j.kind = 'provision-store' and coalesce(j.finished_at, j.step_started_at, j.started_at) >= ${since}
        ${partnerWhere(tx, scope, 's.partner_id')}
    `
  )[0] ?? { started: 0, completed: 0, failed: 0, median_seconds: null }

export const countOpenSetupSessions = async (tx: ScopedSql, scope: DashboardScope, now: Date): Promise<number> =>
  (
    await tx<{ n: number }[]>`
      select count(*)::int as n from partner_setup_session ss
      where ss.ended_at is null and ss.expires_at > ${now} ${partnerWhere(tx, scope, 'ss.partner_id')}
    `
  )[0]?.n ?? 0

export interface PartnerMatch {
  id: string
  name: string
  state: PartnerState
  host: string | null
  owner_email: string | null
}

export interface StoreMatch {
  id: string
  name: string
  code: string
  status: string
  partner_name: string
  owner_email: string | null
  host: string | null
}

/** The header search (FIRST-RELEASE §2): partners and stores by name, domain, code or owner email, capped. */
export const searchPartners = (tx: ScopedSql, term: string, scope: DashboardScope, limit: number): Promise<PartnerMatch[]> =>
  tx<PartnerMatch[]>`
    select p.id, p.name, p.state, pd.host, o.email as owner_email
    from partner p
    left join partner_domain pd on pd.partner_id = p.id and pd.kind = 'portal'
    left join lateral (select email from partner_user u where u.partner_id = p.id and u.role_key = 'partner-owner' order by created_at limit 1) o on true
    where (p.name ilike ${likePattern(term)} or pd.host ilike ${likePattern(term)} or o.email ilike ${likePattern(term)})
      ${partnerWhere(tx, scope, 'p.id')}
    order by p.name limit ${Math.min(limit, maxPageSize)}
  `

export const searchStores = (tx: ScopedSql, term: string, scope: DashboardScope, limit: number): Promise<StoreMatch[]> =>
  tx<StoreMatch[]>`
    select s.id, s.name, s.code, s.status, p.name as partner_name, o.email as owner_email, cd.host
    from store s join partner p on p.id = s.partner_id
    left join lateral (
      select u.email from membership m join "user" u on u.id = m.user_id
      where m.store_id = s.id and m.seller_id is null and m.role_key = 'owner' order by m.created_at limit 1
    ) o on true
    left join lateral (select host from custom_domain where store_id = s.id order by created_at desc limit 1) cd on true
    where (s.name ilike ${likePattern(term)} or s.code ilike ${likePattern(term)} or cd.host ilike ${likePattern(term)} or o.email ilike ${likePattern(term)})
      ${partnerWhere(tx, scope, 's.partner_id')}
    order by s.name limit ${Math.min(limit, maxPageSize)}
  `
