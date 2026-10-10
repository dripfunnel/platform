import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// The store's Activity log (StoreActivity, FIRST-RELEASE §15, LOGGING §6–7; apps/api/src/apis/store/activity.ts).

const entrySchema = z.object({
  id: z.string(),
  at: z.string(),
  category: z.string(),
  action: z.string(),
  result: z.enum(['success', 'denied', 'failed']),
  actor: z.object({ kind: z.string(), id: z.string().nullable(), label: z.string().nullable() }),
  onBehalfOf: z.object({ kind: z.string(), id: z.string(), label: z.string().nullable() }).nullable(),
  through: z.object({ kind: z.string(), id: z.string() }).nullable(),
  target: z.object({ type: z.string(), id: z.string().nullable(), label: z.string().nullable() }).nullable(),
  changes: z.array(z.object({ field: z.string(), before: z.string().nullable(), after: z.string().nullable() })),
  reason: z.string().nullable(),
})
export type ActivityEntry = z.infer<typeof entrySchema>

/** StoreActivity's "What", as the API groups the log (apps/api/src/saas/storeActivity). */
export const activityWhats = ['catalogue', 'orders', 'team', 'settings', 'support', 'shoppers', 'signins'] as const
export type ActivityWhat = (typeof activityWhats)[number]

export interface ActivityFilter {
  person: { kind: string; id: string } | null
  what: ActivityWhat | null
  search: string
}

export interface ActivityPage {
  entries: ActivityEntry[]
  next: string | null
}

const filterOf = (f: ActivityFilter) => ({
  ...(f.person ? { personKind: f.person.kind, personId: f.person.id } : {}),
  ...(f.what ? { what: f.what } : {}),
  ...(f.search.trim() ? { search: f.search.trim() } : {}),
})

/** One page of the log, newest first. */
export const loadActivity = async (filter: ActivityFilter, after: string | null): Promise<ActivityPage> => {
  const { activityLog } = await query(
    'query L($f: StoreActivityFilter, $after: String) { activityLog(filter: $f, first: 50, after: $after) { items { id at category action result actor { kind id label } onBehalfOf { kind id label } through { kind id } target { type id label } changes { field before after } reason } pageInfo { hasNextPage endCursor } } }',
    z.object({ activityLog: z.object({ items: z.array(entrySchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }) }),
    { f: filterOf(filter), after },
  )
  return { entries: activityLog.items, next: activityLog.pageInfo.hasNextPage ? activityLog.pageInfo.endCursor : null }
}

export const loadActivityExport = async (id: string): Promise<ExportJob | null> =>
  readExportJob((await query(`query E($id: ID!) { activityExport(id: $id) { ${exportJobFields} } }`, z.object({ activityExport: exportJobSchema.nullable() }), { id })).activityExport)

/** The log as it's filtered, as a job the shell's watcher follows. */
export const requestActivityExport = async (filter: ActivityFilter): Promise<ExportJob> => {
  const { exportActivity: id } = await query('mutation E($f: StoreActivityFilter) { exportActivity(filter: $f) }', z.object({ exportActivity: z.string() }), { f: filterOf(filter) })
  return { id, state: 'preparing', entries: null, url: null, expiresAt: null }
}
