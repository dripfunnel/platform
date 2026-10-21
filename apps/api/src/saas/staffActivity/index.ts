import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { partnerScopedRoles, roleHas } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import { csvLine } from '#core/csv'
import { activityResults, actorKinds, type ActivityRow } from '#db/schema/activity'
import { activityLevels, type ActivityLevel } from '#db/scoped/activity'
import { insertStaffExportJob, selectStaffExportJob } from '#db/scoped/exportJobs'
import { withScope } from '#db/scoped/index'
import { selectPartnerNames } from '#db/scoped/stores'
import { countSameEmail, isAssignedPartner, selectEntryNames, selectMemberships, selectPeople, selectPerson, selectStoreOptions, type PersonKind } from '#db/scoped/staffActivity'
import { listActivity, type ActivityPageRequest, type PageInfo } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { staffEntry } from '#saas/staff/index'

// The Activity log on the Admin API (ui/admin/FIRST-RELEASE.md §9, LOGGING.md §6–7; card #38):
// staff read every entry through the one scoped path (`listActivity`), follow one person across
// every store and partner, and export a filtered view as a job.

export const staffActivityAudit = { exportActivity: 'activity.exported' } as const
export const peopleMax = 8
export const staffExportCap = 100_000
export const staffExportLifetimeMs = 60 * 60 * 1000

const personKinds = ['staff', 'partner_user', 'person', 'customer'] as const
const refOf = z
  .string()
  .regex(/^[a-z_]+:[0-9a-f-]{36}$/)
  .transform((v) => {
    const [kind = '', id = ''] = v.split(':')
    return { kind, id }
  })
  .pipe(z.object({ kind: z.enum(personKinds), id: z.guid() }))

// §9's filters as the console spells them (`apps/ui/admin/src/api/activity.ts`).
export const staffActivityFilter = z
  .strictObject({
    person: z.string().optional(),
    actor: z.enum(actorKinds).optional(),
    level: z.enum(activityLevels).optional(),
    action: z.string().min(1).max(100).optional(),
    result: z.enum(activityResults).optional(),
    partner: z.guid().optional(),
    store: z.guid().optional(),
    customer: z.guid().optional(),
    target: z.string().regex(/^[a-z_]+:.{1,200}$/).optional(),
    date: z.enum(['today', '7d', '30d']).optional(),
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
    ip: z.union([z.ipv4(), z.ipv6()]).optional(),
    imp: z.guid().optional(),
    su: z.guid().optional(),
  })
  .refine((f) => !(f.imp && f.su), { message: 'one session at a time' })
export type StaffActivityFilter = z.infer<typeof staffActivityFilter>

const day = (d: Date) => d.toISOString().slice(0, 10)

/** The shared log's filter for §9's chips; `from`/`to` replace the preset (decided on #44). */
export const sharedFilterOf = (f: StaffActivityFilter, now: Date): Record<string, unknown> | null => {
  const person = f.person === undefined ? undefined : refOf.safeParse(f.person)
  if (person && !person.success) return null
  const [targetType, ...targetId] = f.target?.split(':') ?? []
  const preset = f.date && !f.from && !f.to ? day(f.date === 'today' ? now : new Date(now.getTime() - (f.date === '7d' ? 6 : 29) * 86_400_000)) : undefined
  return Object.fromEntries(
    Object.entries({
      personKind: person?.data.kind,
      personId: person?.data.id,
      actorKind: f.actor,
      level: f.level,
      action: f.action,
      result: f.result,
      partnerId: f.partner,
      storeId: f.store,
      customerId: f.customer,
      targetType: f.target ? targetType : undefined,
      targetId: f.target ? targetId.join(':') : undefined,
      from: f.from ?? preset,
      to: f.to,
      ip: f.ip,
      accessRef: f.imp ?? f.su,
    }).filter(([, v]) => v !== undefined),
  )
}

const levelOf = (row: ActivityRow): ActivityLevel =>
  row.category === 'security' ? 'security' : row.category === 'system' ? 'system' : row.api === 'admin' ? 'admin' : row.api === 'platform' ? 'partner' : row.api === 'store' ? 'store' : row.api === 'shop' ? 'storefront' : 'system'

const accessKinds = { impersonation: 'impersonation', setup_session: 'setupSession', support_session: 'supportSession' } as const

export const entryOf = (row: ActivityRow, names: { partners: Map<string, string>; stores: Map<string, string> }) => ({
  id: row.id,
  occurredAt: row.occurred_at,
  action: row.action,
  level: levelOf(row),
  result: row.result,
  actor: { kind: row.actor_kind, id: row.actor_id, label: row.actor_label ?? '' },
  onBehalfOf: row.on_behalf_of_id ? { id: row.on_behalf_of_id, label: row.on_behalf_of_label ?? '' } : null,
  access: row.access_kind && row.access_ref ? { kind: accessKinds[row.access_kind], id: row.access_ref } : null,
  partner: row.partner_id ? { id: row.partner_id, name: names.partners.get(row.partner_id) ?? '' } : null,
  store: row.store_id ? { id: row.store_id, name: names.stores.get(row.store_id) ?? '' } : null,
  target: row.target_type && row.target_id ? { type: row.target_type, id: row.target_id, label: row.target_label ?? '' } : null,
  changes: row.changes,
  reason: row.reason,
  requestId: row.request_id ?? '',
  ip: row.ip,
  userAgent: row.user_agent,
})
export type StaffActivityEntry = ReturnType<typeof entryOf>

// LOGGING §6's export columns; no address (decided on #44).
const exportHeader = ['When (UTC)', 'Actor', 'Actor kind', 'Action', 'Target', 'Partner', 'Store', 'Result', 'Reason', 'Request id', 'Changes']
export const staffCsvHeader = csvLine(exportHeader)
export const staffCsvLine = (e: StaffActivityEntry): string =>
  csvLine([
    e.occurredAt.toISOString(),
    e.actor.label,
    e.actor.kind,
    e.action,
    e.target ? e.target.label || `${e.target.type}:${e.target.id}` : null,
    e.partner?.name ?? null,
    e.store?.name ?? null,
    e.result,
    e.reason,
    e.requestId,
    e.changes.length > 0 ? JSON.stringify(e.changes) : null,
  ])

export interface StaffActivityDeps {
  sql: postgres.Sql
  staff: StaffMember
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const createStaffActivityService = ({ sql, staff, facts, activity, now }: StaffActivityDeps) => {
  const context = { caller: { kind: 'staff' as const, staffId: staff.id } }
  const assignedTo = partnerScopedRoles.includes(staff.role) ? staff.id : undefined
  const mayExport = roleHas(staff.role, 'activity.export')

  const page = async (shared: Record<string, unknown>, request: ActivityPageRequest) => {
    const result = await listActivity(sql, context, shared, request, { assignedTo })
    if (!result.ok) return null
    const rows = result.page.items
    return withScope(sql, context, async (tx) => {
      const names = await selectEntryNames(
        tx,
        [...new Set(rows.flatMap((r) => (r.partner_id ? [r.partner_id] : [])))],
        [...new Set(rows.flatMap((r) => (r.store_id ? [r.store_id] : [])))],
      )
      return { items: rows.map((r) => entryOf(r, names)), pageInfo: result.page.pageInfo as PageInfo }
    })
  }

  /** Null for a filter or cursor it cannot read. The partner, store and customer tabs are this with a filter. */
  const activityLog = async (raw: unknown, request: ActivityPageRequest) => {
    const parsed = staffActivityFilter.safeParse(raw ?? {})
    const shared = parsed.success ? sharedFilterOf(parsed.data, now()) : null
    if (!shared) return null
    const entries = await page(shared, request)
    if (!entries) return null
    return withScope(sql, context, async (tx) => ({
      ...entries,
      export: mayExport ? { allowed: true as const } : { allowed: false as const, reason: 'EXPORTERS_ONLY' as const },
      partners: await selectPartnerNames(tx, assignedTo),
      stores: (await selectStoreOptions(tx, assignedTo)).map((s) => ({ id: s.id, name: s.name, partnerId: s.partner_id })),
    }))
  }

  /** One person across every store and partner (LOGGING §6): staff only, as every field here is. */
  const personTimeline = async (ref: string, raw: unknown, request: ActivityPageRequest) => {
    const parsed = staffActivityFilter.safeParse({ ...((raw ?? {}) as object), person: ref })
    const shared = parsed.success ? sharedFilterOf(parsed.data, now()) : null
    return shared ? page(shared, request) : null
  }

  // A shopper's email never shows here: the Customers page decides who sees it (§5.4), and an
  // exact email still finds them.
  const emailFor = (kind: PersonKind, email: string | null) => (kind === 'customer' ? '' : (email ?? ''))

  const activityPeople = async (query: string) => {
    const term = z.string().trim().min(2).max(100).safeParse(query)
    if (!term.success) return null
    return withScope(sql, context, async (tx) =>
      (await selectPeople(tx, term.data, peopleMax, assignedTo)).map((p) => ({ id: `${p.kind}:${p.id}`, name: p.name, email: emailFor(p.kind, p.email), kind: p.kind, where: p.where_label })),
    )
  }

  /** The finder's chosen person, with where they work and how many other accounts share the email. */
  const activityPerson = async (ref: string) => {
    const r = refOf.safeParse(ref)
    if (!r.success) return null
    const { kind, id } = r.data
    return withScope(sql, context, async (tx) => {
      const person = await selectPerson(tx, kind, id)
      if (!person) return null
      if (assignedTo !== undefined && person.partner_id !== null && !(await isAssignedPartner(tx, assignedTo, person.partner_id))) return null
      return {
        id: ref,
        name: person.name,
        email: emailFor(kind, person.email),
        kind,
        where: person.where_label,
        memberships: (await selectMemberships(tx, kind, id)).map((m) => ({ where: m.where_label, role: m.role })),
        sameEmailAccounts: person.email ? await countSameEmail(tx, person.email, assignedTo) : 0,
      }
    })
  }

  type ExportResult = { ok: true; jobId: string } | { ok: false; reason: 'EXPORTERS_ONLY' | 'INVALID_INPUT' }

  // LOGGING §6: Super admin and Engineer on call, a job, logged with who and which filter.
  const exportActivity = async (raw: unknown): Promise<ExportResult> => {
    if (!mayExport) return { ok: false, reason: 'EXPORTERS_ONLY' }
    const parsed = staffActivityFilter.safeParse(raw ?? {})
    const shared = parsed.success ? sharedFilterOf(parsed.data, now()) : null
    if (!shared) return { ok: false, reason: 'INVALID_INPUT' }
    return withScope(sql, context, async (tx): Promise<ExportResult> => {
      const jobId = await insertStaffExportJob(tx, { filter: shared, byId: staff.id, byLabel: staff.name })
      await queueSideEffect(tx, { kind: 'export.staff_activity', idempotencyKey: jobId, payload: { jobId, staffId: staff.id }, partnerId: null, storeId: null })
      await activity.record(
        tx,
        staffEntry(staff, facts)({ action: staffActivityAudit.exportActivity, target: { type: 'export', id: jobId, label: 'Activity log' }, reason: null, visibility: 'staff', changes: [{ field: 'filter', before: null, after: JSON.stringify(shared) }] }),
      )
      return { ok: true, jobId }
    })
  }

  /** The job as §9's screen reads it: preparing, ready (with the file), expired, too large or failed. Null for one that isn't a staff export. */
  const activityExport = async (id: string) => {
    if (!mayExport || !z.guid().safeParse(id).success) return null
    return withScope(sql, context, async (tx) => {
      const job = await selectStaffExportJob(tx, id)
      if (!job) return null
      const expired = job.expires_at !== null && job.expires_at <= now()
      const state = job.state === 'queued' ? 'preparing' : job.state === 'too_large' ? 'tooLarge' : job.state === 'failed' ? 'failed' : expired ? 'expired' : 'ready'
      return { id: job.id, state, entries: job.rows, csv: state === 'ready' ? job.csv : null, expiresAt: job.expires_at }
    })
  }

  return { activityLog, personTimeline, activityPeople, activityPerson, exportActivity, activityExport }
}

export type StaffActivityService = ReturnType<typeof createStaffActivityService>
