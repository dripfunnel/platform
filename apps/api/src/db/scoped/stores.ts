import type { Keyset } from '#core/cursor'
import type {
  BuildState,
  CustomDomainRow,
  HostStatus,
  JobDetailRow,
  JobRow,
  JobState,
  MembershipRole,
  MembershipRow,
  ProvisioningStep,
  StoreNoteRow,
  StoreRow,
  StoreStatus,
  UserRow,
} from '../schema/saas'
import type { ScopedSql } from './index'

const one = <T extends { id: string }>(rows: T[], table: string): string => {
  const row = rows[0]
  if (!row) throw new Error(`${table} insert returned no row`)
  return row.id
}

/** A search term as an ILIKE pattern, its own `%` and `_` escaped so they match literally. */
export const likePattern = (term: string): string => `%${term.replaceAll(/[\\%_]/g, '\\$&')}%`

export const insertSeller = async (tx: ScopedSql, s: { storeId: string; name: string; accessLevel?: string; status?: string }): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into seller (store_id, name, access_level, status)
      values (${s.storeId}, ${s.name}, ${s.accessLevel ?? 'vendor-stock'}, ${s.status ?? 'active'}) returning id
    `,
    'seller',
  )

/** The partner a store belongs to, or null when the caller's scope doesn't see it. */
export const partnerOfStore = async (tx: ScopedSql, storeId: string): Promise<string | null> => {
  const rows = await tx<{ partner_id: string }[]>`select partner_id from store where id = ${storeId}`
  return rows[0]?.partner_id ?? null
}

export interface NewStore {
  partnerId: string
  name: string
  code: string
  country?: string | null
  status?: StoreStatus
  planId?: string | null
  trialEndsAt?: Date | null
  pastDueSince?: Date | null
  cancelledAt?: Date | null
  storefrontKind?: 'ai' | 'own'
  buildState?: BuildState | null
  coreVersion?: string | null
  lastBuildAt?: Date | null
  lastPublishAt?: Date | null
  supportAccessAllowed?: boolean
  createdAt?: Date
}

export const insertStore = async (tx: ScopedSql, s: NewStore): Promise<string> => {
  const kind = s.storefrontKind ?? 'ai'
  return one(
    await tx<{ id: string }[]>`
      insert into store (partner_id, name, code, country, status, plan_id, trial_ends_at, past_due_since, cancelled_at,
                         storefront_kind, build_state, core_version, last_build_at, last_publish_at, support_access_allowed, created_at)
      values (${s.partnerId}, ${s.name}, ${s.code}, ${s.country ?? null}, ${s.status ?? 'trial'}, ${s.planId ?? null},
              ${s.trialEndsAt ?? null}, ${s.pastDueSince ?? null}, ${s.cancelledAt ?? null},
              ${kind}, ${kind === 'own' ? null : (s.buildState ?? null)}, ${s.coreVersion ?? null},
              ${s.lastBuildAt ?? null}, ${s.lastPublishAt ?? null}, ${s.supportAccessAllowed ?? true}, ${s.createdAt ?? new Date()})
      returning id
    `,
    'store',
  )
}

/** The columns a status change writes (saas/stores/states.ts decides which). */
export interface StoreStatusPatch {
  status: StoreStatus
  trialEndsAt?: Date | null
  pastDueSince?: Date | null
  suspendedAt?: Date | null
  suspendedReason?: string | null
  suspendedByLabel?: string | null
  suspendedPreviousStatus?: StoreRow['suspended_previous_status']
  cancelledAt?: Date | null
  closedAt?: Date | null
}

export const updateStoreStatus = async (tx: ScopedSql, id: string, patch: StoreStatusPatch): Promise<boolean> => {
  const rows = await tx<{ id: string }[]>`
    update store set
      status = ${patch.status},
      trial_ends_at = ${patch.trialEndsAt === undefined ? tx`trial_ends_at` : patch.trialEndsAt},
      past_due_since = ${patch.pastDueSince === undefined ? tx`past_due_since` : patch.pastDueSince},
      suspended_at = ${patch.suspendedAt === undefined ? tx`suspended_at` : patch.suspendedAt},
      suspended_reason = ${patch.suspendedReason === undefined ? tx`suspended_reason` : patch.suspendedReason},
      suspended_by_label = ${patch.suspendedByLabel === undefined ? tx`suspended_by_label` : patch.suspendedByLabel},
      suspended_previous_status = ${patch.suspendedPreviousStatus === undefined ? tx`suspended_previous_status` : patch.suspendedPreviousStatus},
      cancelled_at = ${patch.cancelledAt === undefined ? tx`cancelled_at` : patch.cancelledAt},
      closed_at = ${patch.closedAt === undefined ? tx`closed_at` : patch.closedAt}
    where id = ${id}
    returning id
  `
  return rows.length > 0
}

export interface NewUser {
  partnerId: string
  email: string
  name: string
  status: UserRow['status']
  lastSignInAt?: Date | null
}

export const insertUser = async (tx: ScopedSql, u: NewUser): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into "user" (partner_id, email, name, status, last_sign_in_at)
      values (${u.partnerId}, ${u.email}, ${u.name}, ${u.status}, ${u.lastSignInAt ?? null})
      returning id
    `,
    'user',
  )

export interface NewMembership {
  userId: string
  storeId: string
  sellerId?: string | null
  role: MembershipRole
  status: MembershipRow['status']
}

export const insertMembership = async (tx: ScopedSql, m: NewMembership): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into membership (user_id, store_id, seller_id, role_key, status)
      values (${m.userId}, ${m.storeId}, ${m.sellerId ?? null}, ${m.role}, ${m.status})
      returning id
    `,
    'membership',
  )

export interface NewCustomDomain {
  storeId: string
  host: string
  status: HostStatus
  expectedCname: string
  foundCname?: string | null
  ownershipToken: string
  ownershipFound?: string | null
  checkedAt?: Date | null
}

export const insertCustomDomain = async (tx: ScopedSql, d: NewCustomDomain): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into custom_domain (store_id, host, status, expected_cname, found_cname, ownership_token, ownership_found, checked_at)
      values (${d.storeId}, ${d.host}, ${d.status}, ${d.expectedCname}, ${d.foundCname ?? null}, ${d.ownershipToken}, ${d.ownershipFound ?? null}, ${d.checkedAt ?? null})
      returning id
    `,
    'custom_domain',
  )

export interface NewJob {
  storeId: string
  state: JobState
  steps: readonly ProvisioningStep[]
  step: ProvisioningStep
  stepStartedAt?: Date
  attempts?: number
  startedAt?: Date
  finishedAt?: Date | null
  lastError?: string | null
  details?: string | null
}

export const insertJob = async (tx: ScopedSql, j: NewJob): Promise<string> => {
  const id = one(
    await tx<{ id: string }[]>`
      insert into job (store_id, kind, state, steps, step, step_started_at, attempts, started_at, finished_at, last_error)
      values (${j.storeId}, 'provision-store', ${j.state}, ${[...j.steps]}, ${j.step}, ${j.stepStartedAt ?? j.startedAt ?? new Date()},
              ${j.attempts ?? 1}, ${j.startedAt ?? new Date()}, ${j.finishedAt ?? null}, ${j.lastError ?? null})
      returning id
    `,
    'job',
  )
  if (j.details) await tx`insert into job_detail (job_id, details) values (${id}, ${j.details})`
  return id
}

export const selectJobDetail = async (tx: ScopedSql, jobId: string): Promise<JobDetailRow | null> =>
  (await tx<JobDetailRow[]>`select * from job_detail where job_id = ${jobId}`)[0] ?? null

export const insertStoreNote = async (tx: ScopedSql, n: { storeId: string; staffUserId: string; text: string; createdAt?: Date }): Promise<string> =>
  one(
    await tx<{ id: string }[]>`
      insert into store_note (store_id, staff_user_id, text, created_at)
      values (${n.storeId}, ${n.staffUserId}, ${n.text}, ${n.createdAt ?? new Date()}) returning id
    `,
    'store_note',
  )

export interface StoreFilter {
  partnerId?: string | undefined
  status?: StoreStatus | undefined
  /** `own` is a store with its own frontend; the rest are build states (FIRST-RELEASE §5.1). */
  storefront?: BuildState | 'own' | undefined
  /** From the latest signup job, as saas/provisioning/stuck.ts derives it; `stuck` is a running step past its limit (decided on #43). */
  setup?: 'done' | 'running' | 'failed' | 'stuck' | 'cleaning' | undefined
  createdAfter?: Date | undefined
  /** Name, code, custom domain or owner email. */
  q?: string | undefined
}

export interface KeysetPage {
  after?: Keyset | undefined
  before?: Keyset | undefined
}

/** FIRST-RELEASE §5.1's columns, one query, newest first by (created_at, id). */
export interface StoreListRow extends StoreRow {
  partner_name: string
  plan_name: string | null
  owner_name: string | null
  owner_email: string | null
  domain_host: string | null
  domain_status: HostStatus | null
  job_id: string | null
  job_state: JobState | null
  job_step: ProvisioningStep | null
  job_steps: ProvisioningStep[] | null
  job_attempts: number | null
  job_step_started_at: Date | null
}

export const selectStores = async (
  tx: ScopedSql,
  filter: StoreFilter,
  page: KeysetPage,
  limit: number,
  stuckAfterMinutes: Readonly<Record<ProvisioningStep, number>>,
  now: Date,
): Promise<StoreListRow[]> => {
  const backwards = page.before !== undefined
  const q = filter.q ? likePattern(filter.q) : null
  const stuck = tx`(j.state = 'running' and j.step_started_at < ${now}::timestamptz - ((${JSON.stringify(stuckAfterMinutes)}::text::jsonb ->> j.step) || ' minutes')::interval)`
  const rows = await tx<StoreListRow[]>`
    select s.*, p.name as partner_name, pl.name as plan_name,
      o.name as owner_name, o.email as owner_email,
      cd.host as domain_host, cd.status as domain_status,
      j.id as job_id, j.state as job_state, j.step as job_step, j.steps as job_steps, j.attempts as job_attempts, j.step_started_at as job_step_started_at
    from store s
    join partner p on p.id = s.partner_id
    left join plan pl on pl.id = s.plan_id
    left join lateral (
      select u.name, u.email from membership m join "user" u on u.id = m.user_id
      where m.store_id = s.id and m.seller_id is null and m.role_key = 'owner' order by m.created_at limit 1
    ) o on true
    left join lateral (select host, status from custom_domain where store_id = s.id order by created_at desc limit 1) cd on true
    left join lateral (select * from job where store_id = s.id order by started_at desc limit 1) j on true
    where true
      ${filter.partnerId !== undefined ? tx`and s.partner_id = ${filter.partnerId}` : tx``}
      ${filter.status !== undefined ? tx`and s.status = ${filter.status}` : tx``}
      ${filter.storefront === 'own' ? tx`and s.storefront_kind = 'own'` : tx``}
      ${filter.storefront !== undefined && filter.storefront !== 'own' ? tx`and s.build_state = ${filter.storefront}` : tx``}
      ${filter.setup === 'done' ? tx`and (j.id is null or j.state in ('done', 'undone'))` : tx``}
      ${filter.setup === 'failed' ? tx`and j.state = 'failed'` : tx``}
      ${filter.setup === 'cleaning' ? tx`and j.state = 'cleaning'` : tx``}
      ${filter.setup === 'stuck' ? tx`and ${stuck}` : tx``}
      ${filter.setup === 'running' ? tx`and j.state = 'running' and not ${stuck}` : tx``}
      ${filter.createdAfter !== undefined ? tx`and s.created_at >= ${filter.createdAfter}` : tx``}
      ${q !== null ? tx`and (s.name ilike ${q} or s.code ilike ${q} or cd.host ilike ${q} or o.email ilike ${q})` : tx``}
      ${page.after !== undefined ? tx`and s.created_at <= ${page.after.occurredAt} and (s.created_at, s.id) < (${page.after.occurredAt}, ${page.after.id}::uuid)` : tx``}
      ${page.before !== undefined ? tx`and s.created_at >= ${page.before.occurredAt} and (s.created_at, s.id) > (${page.before.occurredAt}, ${page.before.id}::uuid)` : tx``}
    ${backwards ? tx`order by s.created_at asc, s.id asc` : tx`order by s.created_at desc, s.id desc`}
    limit ${limit + 1}
  `
  return backwards ? rows.reverse() : rows
}

export const selectStore = async (tx: ScopedSql, id: string): Promise<StoreRow | null> =>
  (await tx<StoreRow[]>`select * from store where id = ${id}`)[0] ?? null

export interface StorePerson extends MembershipRow {
  name: string
  email: string
  user_status: UserRow['status']
  last_sign_in_at: Date | null
  seller_name: string | null
}

/** Everyone in the store, merchant side and each supplier's team (FIRST-RELEASE §5.2 Users). */
export const selectStorePeople = (tx: ScopedSql, storeId: string): Promise<StorePerson[]> =>
  tx<StorePerson[]>`
    select m.*, u.name, u.email, u.status as user_status, u.last_sign_in_at, se.name as seller_name
    from membership m
    join "user" u on u.id = m.user_id
    left join seller se on se.id = m.seller_id
    where m.store_id = ${storeId}
    order by case m.role_key when 'owner' then 0 when 'manager' then 1 when 'staff' then 2 when 'supplier-admin' then 3 else 4 end,
      se.name nulls first, u.name
  `

export const selectCustomDomains = (tx: ScopedSql, storeId: string): Promise<CustomDomainRow[]> =>
  tx<CustomDomainRow[]>`select * from custom_domain where store_id = ${storeId} order by created_at desc`

export const selectLatestJob = async (tx: ScopedSql, storeId: string): Promise<JobRow | null> =>
  (await tx<JobRow[]>`select * from job where store_id = ${storeId} order by started_at desc limit 1`)[0] ?? null

export const selectStoreNotes = (tx: ScopedSql, storeId: string): Promise<(StoreNoteRow & { by_name: string })[]> =>
  tx<(StoreNoteRow & { by_name: string })[]>`
    select n.*, st.name as by_name from store_note n join staff_user st on st.id = n.staff_user_id
    where n.store_id = ${storeId} order by n.created_at desc
  `
