import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { ActivityRow } from '#db/schema/activity'
import { activityResults } from '#db/schema/activity'
import { activityWhos } from '#db/scoped/activity'
import { personInScope, selectActivityPeople, type ActivityPerson } from '#db/scoped/activityPeople'
import { insertExportJob, selectExportJob } from '#db/scoped/exportJobs'
import { withScope } from '#db/scoped/index'
import { listActivity, partnerEntry, type ActivityPageRequest, type PageInfo } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'

// The partner Activity log on the Platform API (ui/platform/FIRST-RELEASE.md §13; card #198).
// What a partner may read is the log's own policy (migrations/0006, LOGGING §6): entries with
// `partner` visibility in its partner. Entries carry their code and facts; the console words
// them per locale (LOGGING §7).

export { activityCsvHeader, activityCsvLine } from './csv'

export const activityAudit = { exportActivity: 'activity.exported' } as const
export const peopleMax = 8
export const exportMaxRows = 10_000
export const exportLifetimeMs = 60 * 60 * 1000
const exporters: readonly string[] = ['partner-owner', 'partner-admin']

// FIRST-RELEASE §13's chips, as the console spells them; all optional and in the URL.
export const partnerActivityFilter = z.strictObject({
  who: z.enum(activityWhos).optional(),
  action: z.string().min(1).max(100).optional(),
  result: z.enum(activityResults).optional(),
  storeId: z.guid().optional(),
  date: z.enum(['today', '7d', '30d']).optional(),
})
export type PartnerActivityFilter = z.infer<typeof partnerActivityFilter>

const personRef = z.union([
  z.string().regex(/^team:/).transform((v) => ({ kind: 'team' as const, id: v.slice(5) })).pipe(z.object({ kind: z.literal('team'), id: z.guid() })),
  z.string().regex(/^owner:/).transform((v) => ({ kind: 'owner' as const, id: v.slice(6) })).pipe(z.object({ kind: z.literal('owner'), id: z.guid() })),
])

const day = (d: Date) => d.toISOString().slice(0, 10)

/** The shared log's filter for these chips, from `now`'s UTC day. */
export const logFilterOf = (f: PartnerActivityFilter, now: Date): Record<string, unknown> => ({
  ...(f.who ? { who: f.who } : {}),
  ...(f.action ? { action: f.action } : {}),
  ...(f.result ? { result: f.result } : {}),
  ...(f.storeId ? { storeId: f.storeId } : {}),
  ...(f.date ? { from: day(f.date === 'today' ? now : new Date(now.getTime() - (f.date === '7d' ? 6 : 29) * 24 * 60 * 60 * 1000)) } : {}),
})

export const entryDto = (row: ActivityRow) => ({
  id: row.id,
  at: row.occurred_at,
  category: row.category,
  action: row.action,
  result: row.result,
  actor: { kind: row.actor_kind, id: row.actor_id, label: row.actor_label },
  onBehalfOf: row.on_behalf_of_label,
  // "DripFunnel setup" and support-session rows are tagged (FIRST-RELEASE §13).
  through: row.access_kind,
  storeId: row.store_id,
  target: row.target_type ? { type: row.target_type, id: row.target_id, label: row.target_label } : null,
  changes: row.changes,
  reason: row.reason,
})
export type PartnerActivityEntry = ReturnType<typeof entryDto>
export type PartnerActivityPage = { items: PartnerActivityEntry[]; pageInfo: PageInfo }

export interface PartnerActivityDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const createPartnerActivityService = ({ sql, caller, facts, activity, now }: PartnerActivityDeps) => {
  const partnerId = caller.partner.id
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId }

  const read = async (logFilter: Record<string, unknown>, page: ActivityPageRequest): Promise<PartnerActivityPage | null> => {
    const result = await listActivity(sql, context, logFilter, page)
    return result.ok ? { items: result.page.items.map(entryDto), pageInfo: result.page.pageInfo } : null
  }

  /** Null for a filter or cursor it cannot read. The store tab and My activity are this with a filter. */
  const activityLog = (raw: unknown, page: ActivityPageRequest) => {
    const parsed = partnerActivityFilter.safeParse(raw ?? {})
    return parsed.success ? read(logFilterOf(parsed.data, now()), page) : Promise.resolve(null)
  }

  /** A person's own entries: a team member's, or one of its merchants' Owners'. Null outside the partner. */
  const personTimeline = async (ref: unknown, raw: unknown, page: ActivityPageRequest): Promise<PartnerActivityPage | null> => {
    const r = personRef.safeParse(ref)
    const parsed = partnerActivityFilter.safeParse(raw ?? {})
    if (!r.success || !parsed.success) return null
    const { kind, id } = r.data
    if (!(await withScope(sql, context, (tx) => personInScope(tx, partnerId, kind, id)))) return null
    return read({ ...logFilterOf(parsed.data, now()), actorKind: kind === 'team' ? 'partner_user' : 'person', actorId: id }, page)
  }

  const activityPeople = (query: unknown): Promise<(ActivityPerson & { ref: string })[] | null> => {
    const term = z.string().trim().min(2).max(100).safeParse(query)
    if (!term.success) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => (await selectActivityPeople(tx, partnerId, term.data, peopleMax)).map((p) => ({ ...p, ref: `${p.kind}:${p.id}` })))
  }

  type ExportResult = { ok: true; jobId: string } | { ok: false; reason: 'OWNERS_AND_ADMINS_ONLY' | 'INVALID_INPUT' }

  // LOGGING §6: Owner and Admin export, and only they read an export back; every export is logged.
  const exportActivity = (raw: unknown): Promise<ExportResult> => {
    if (!exporters.includes(caller.user.role)) return Promise.resolve({ ok: false, reason: 'OWNERS_AND_ADMINS_ONLY' })
    const parsed = partnerActivityFilter.safeParse(raw ?? {})
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const filter = logFilterOf(parsed.data, now())
    return withScope(sql, context, async (tx): Promise<ExportResult> => {
      const jobId = await insertExportJob(tx, { partnerId, kind: 'activity', filter, byId: caller.user.id, byLabel: caller.user.name })
      await queueSideEffect(tx, { kind: 'export.activity', idempotencyKey: jobId, payload: { jobId, partnerId, partnerUserId: caller.user.id }, partnerId, storeId: null })
      await activity.record(tx, partnerEntry(caller, facts)({ action: activityAudit.exportActivity, target: { type: 'export', id: jobId, label: 'Activity log' }, reason: null, changes: [{ field: 'filter', before: null, after: JSON.stringify(filter) }] }))
      return { ok: true, jobId }
    })
  }

  /** The job's state; its CSV until it expires. Null for an id that isn't the partner's, or for a role that may not export. */
  const exportJob = (id: string) => {
    if (!exporters.includes(caller.user.role) || !z.guid().safeParse(id).success) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const job = await selectExportJob(tx, id)
      if (!job) return null
      const expired = job.expires_at !== null && job.expires_at <= now()
      return { id: job.id, state: expired ? ('expired' as const) : job.state, rows: job.rows, truncated: job.truncated, csv: expired ? null : job.csv, expiresAt: job.expires_at }
    })
  }

  return { activityLog, personTimeline, activityPeople, exportActivity, exportJob }
}

export type PartnerActivityService = ReturnType<typeof createPartnerActivityService>
