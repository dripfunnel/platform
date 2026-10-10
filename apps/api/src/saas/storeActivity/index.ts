import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { StoreCaller } from '#auth/storeCaller'
import { activityResults, type ActivityRow } from '#db/schema/activity'
import { selectActivity, type KeysetPage } from '#db/scoped/activity'
import { insertCatalogExport, selectCatalogExport, type CatalogExportRow } from '#db/scoped/catalogExports'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { exportDtoOf, jobPayloadOf, type CatalogExportDto, type CatalogJobPayload } from '#engine/modules/catalog/index'
import { activityFilter, listActivity, queryOf, type ActivityPageRequest, type PageInfo } from '#saas/activity/index'
import { activityAudit, activityCsvHeader, activityCsvLine, exportMaxRows } from '#saas/partnerActivity/index'

// The store's Activity log (FIRST-RELEASE §15, StoreActivity; LOGGING §6–7; #331): the whole store's
// entries for its Owner and Manager, the CSV for the Owner. Which entries a store reads is the log's
// own policy (0006, 0007): its own, and the partner's that name it; never a `staff` one.

// LOGGING §6: a store's export caps, and is logged, as the partner's is.
export { activityAudit, exportMaxRows } from '#saas/partnerActivity/index'

/** StoreActivity's "What": action families, or one of the log's own columns. */
const families = {
  catalogue: ['product', 'stock', 'collection', 'filter', 'menu', 'badge', 'size_chart', 'product_story', 'story_block', 'warehouse', 'catalogue', 'catalog', 'asset', 'shopify'],
  orders: ['order', 'orders', 'refund', 'return', 'payment'],
  team: ['member', 'supplier', 'supplier_team'],
  settings: ['store', 'tax', 'tax_class', 'tax_zone', 'tax_rate', 'invoice_settings', 'shipping', 'courier', 'payment_method', 'market', 'custom_domain', 'storefront', 'api_key', 'webhook', 'app', 'support_access'],
} as const
export const activityWhats = ['catalogue', 'orders', 'team', 'settings', 'support', 'shoppers', 'signins'] as const

// The kinds a person in StoreActivity's Person list is: a team member or supplier user, a shopper,
// an API key, an app, a support agent (as `on_behalf_of`), or the system.
const personKinds = ['person', 'customer', 'partner_user', 'api_key', 'app_grant', 'support_session', 'job', 'provider'] as const

export const storeActivityFilter = z
  .strictObject({
    personKind: z.enum(personKinds).optional(),
    personId: z.string().min(1).max(200).optional(),
    what: z.enum(activityWhats).optional(),
    result: z.enum(activityResults).optional(),
    search: z.string().trim().min(1).max(100).optional(),
    /** UTC calendar days, inclusive. */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .refine((f) => (f.personKind === undefined) === (f.personId === undefined))
export type StoreActivityFilter = z.infer<typeof storeActivityFilter>

/** The shared log's filter (saas/activity) for these choices. */
const logFilterOf = (f: StoreActivityFilter): z.input<typeof activityFilter> => ({
  ...(f.personKind && f.personId ? { personKind: f.personKind, personId: f.personId } : {}),
  ...(f.result ? { result: f.result } : {}),
  ...(f.search ? { search: f.search } : {}),
  ...(f.from ? { from: f.from } : {}),
  ...(f.to ? { to: f.to } : {}),
  ...(f.what === 'support' ? { who: 'support' as const } : f.what === 'shoppers' ? { actorKind: 'customer' as const } : f.what === 'signins' ? { category: 'auth' as const } : f.what ? { families: [...families[f.what]] } : {}),
})

/** An entry as the store reads it: never an address, user agent, host or request id (LOGGING §4). */
export const storeEntryDto = (row: ActivityRow) => ({
  id: row.id,
  at: row.occurred_at,
  category: row.category,
  action: row.action,
  result: row.result,
  actor: { kind: row.actor_kind, id: row.actor_id, label: row.actor_label },
  onBehalfOf: row.on_behalf_of_kind && row.on_behalf_of_id ? { kind: row.on_behalf_of_kind, id: row.on_behalf_of_id, label: row.on_behalf_of_label } : null,
  through: row.access_kind && row.access_ref ? { kind: row.access_kind, id: row.access_ref } : null,
  sellerId: row.seller_id,
  customerId: row.customer_id,
  target: row.target_type ? { type: row.target_type, id: row.target_id, label: row.target_label } : null,
  changes: row.changes,
  reason: row.reason,
})
export type StoreActivityEntry = ReturnType<typeof storeEntryDto>

export type StoreActivityRefusal = 'INVALID_INPUT'

export interface StoreActivityDeps {
  sql: postgres.Sql
  caller: StoreCaller
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  /** Queues the job's outbox row in the same transaction. */
  queue: (tx: ScopedSql, payload: CatalogJobPayload) => Promise<unknown>
}

export const createStoreActivityService = ({ sql, caller, activity, facts, now, queue }: StoreActivityDeps) => {
  const { context } = caller
  const storeId = caller.store.id
  const actorId = caller.person.id

  /** Newest first by keyset, at most the log's page size, never a total. Null for a filter or cursor it can't read. */
  const activityLog = async (raw: unknown, page: ActivityPageRequest): Promise<{ items: StoreActivityEntry[]; pageInfo: PageInfo } | null> => {
    const parsed = storeActivityFilter.safeParse(raw ?? {})
    if (!parsed.success) return null
    const result = await listActivity(sql, context, logFilterOf(parsed.data), page)
    return result.ok ? { items: result.page.items.map(storeEntryDto), pageInfo: result.page.pageInfo } : null
  }

  /** The Owner's CSV of the filtered view, built after commit in the asker's own scope (LOGGING §6). */
  const exportActivity = async (raw: unknown): Promise<{ ok: true; jobId: string } | { ok: false; reason: StoreActivityRefusal }> => {
    const parsed = storeActivityFilter.safeParse(raw ?? {})
    if (!parsed.success || !jobPayloadOf(context, storeId)) return { ok: false, reason: 'INVALID_INPUT' }
    const filter = parsed.data
    const jobId = await withScope(sql, context, async (tx) => {
      const id = await insertCatalogExport(tx, { storeId, sellerId: null, kind: 'activity', filter, byId: actorId, byLabel: caller.person.name || caller.person.email })
      const payload = jobPayloadOf(context, id)
      if (payload) await queue(tx, payload)
      await activity.record(tx, {
        category: 'write',
        action: activityAudit.exportActivity,
        result: 'success',
        actorKind: 'person',
        actorId,
        actorLabel: null,
        partnerId: context.partnerId,
        storeId,
        target: { type: 'export', id, label: 'Activity log' },
        reason: null,
        // LOGGING §4.1: the search text is often a name or an email, so the entry says only that there was one.
        changes: [{ field: 'filter', before: null, after: JSON.stringify({ ...filter, ...(filter.search ? { search: 'searched' } : {}) }) }],
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      return id
    })
    return { ok: true, jobId }
  }

  /** The export's state and its file until it expires; null for an id the caller didn't ask for. */
  const exportJob = (id: string): Promise<CatalogExportDto | null> => {
    if (!z.guid().safeParse(id).success) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const job = await selectCatalogExport(tx, storeId, id)
      return job && job.kind === 'activity' && job.requested_by_id === actorId ? exportDtoOf(job, now()) : null
    })
  }

  return { activityLog, exportActivity, exportJob }
}

export type StoreActivityService = ReturnType<typeof createStoreActivityService>

const pageRows = 100

/** The file, read in the asker's own scope a page at a time as the screen reads it, cut at the cap with a last line saying so. */
export const buildActivityExport = async (tx: ScopedSql, job: CatalogExportRow, max = exportMaxRows): Promise<{ rows: number; truncated: boolean; csv: string }> => {
  const query = queryOf(activityFilter.parse(logFilterOf(storeActivityFilter.parse(job.filter))))
  const lines = [activityCsvHeader]
  let after: KeysetPage['after']
  let truncated = false
  for (;;) {
    const rows = await selectActivity(tx, query, { after }, pageRows)
    for (const row of rows.slice(0, pageRows)) {
      if (lines.length - 1 === max) {
        truncated = true
        break
      }
      lines.push(activityCsvLine(row))
    }
    const last = rows[Math.min(rows.length, pageRows) - 1]
    if (truncated || rows.length <= pageRows || !last) break
    after = { occurredAt: last.occurred_at, id: last.id }
  }
  const count = lines.length - 1
  if (truncated) lines.push(`Cut at ${max} entries: narrow the dates or the filter for the rest.`)
  return { rows: count, truncated, csv: lines.join('\n') }
}
