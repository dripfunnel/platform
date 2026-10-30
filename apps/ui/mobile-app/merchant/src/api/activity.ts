import { z } from 'zod'
import { typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from './exportJob'

// The store's Activity log (StoreActivity; FIRST-RELEASE (store) §15; LOGGING.md §6–7; apps/api src/apis/store/activity.ts).

const entrySchema = z.object({
  id: z.string(),
  at: z.string(),
  category: z.string(),
  action: z.string(),
  result: z.enum(['success', 'denied', 'failed']),
  actor: z.object({ kind: z.string(), id: z.string().nullable(), label: z.string().nullable() }),
  onBehalfOf: z.object({ kind: z.string(), id: z.string().nullable(), label: z.string().nullable() }).nullable(),
  through: z.object({ kind: z.string(), id: z.string().nullable() }).nullable(),
  target: z.object({ type: z.string(), id: z.string().nullable(), label: z.string().nullable() }).nullable(),
  changes: z.array(z.object({ field: z.string(), before: z.string().nullable(), after: z.string().nullable() })),
  reason: z.string().nullable(),
})
export type ActivityEntry = z.infer<typeof entrySchema>

/** "What", as the API groups the log (apps/api src/saas/storeActivity). */
export const activityWhats = ['catalogue', 'orders', 'team', 'settings', 'support', 'shoppers', 'signins'] as const
export type ActivityWhat = (typeof activityWhats)[number]

export type ActivityFilter = {
  person: { kind: string; id: string } | null
  what: ActivityWhat | null
  search: string
}

export type ActivityPage = { entries: ActivityEntry[]; next: string | null }

const filterOf = (filter: ActivityFilter) => ({
  ...(filter.person ? { personKind: filter.person.kind, personId: filter.person.id } : {}),
  ...(filter.what ? { what: filter.what } : {}),
  ...(filter.search.trim() ? { search: filter.search.trim() } : {}),
})

/** One page of 50, newest first. */
export const loadActivity = async (client: ApiClient, filter: ActivityFilter, after: string | null): Promise<ActivityPage> => {
  const { activityLog } = await typedQuery(client)(
    'query Activity($f: StoreActivityFilter, $after: String) { activityLog(filter: $f, first: 50, after: $after) { items { id at category action result actor { kind id label } onBehalfOf { kind id label } through { kind id } target { type id label } changes { field before after } reason } pageInfo { hasNextPage endCursor } } }',
    z.object({ activityLog: z.object({ items: z.array(entrySchema), pageInfo: z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() }) }).nullable() }),
    { f: filterOf(filter), after },
  )
  if (!activityLog) throw new Error('activity log missing')
  return { entries: activityLog.items, next: activityLog.pageInfo.hasNextPage ? activityLog.pageInfo.endCursor : null }
}

export const loadActivityExport = async (client: ApiClient, id: string): Promise<ExportJob | null> =>
  readExportJob((await typedQuery(client)(`query ActivityExport($id: ID!) { activityExport(id: $id) { ${exportJobFields} } }`, z.object({ activityExport: exportJobSchema.nullable() }), { id })).activityExport)

/** The log as it is filtered, as a job; answers its id. `activity.export` is the Owner's alone. */
export const requestActivityExport = async (client: ApiClient, filter: ActivityFilter): Promise<string> => {
  const { exportActivity } = await typedQuery(client)('mutation ExportActivity($f: StoreActivityFilter) { exportActivity(filter: $f) }', z.object({ exportActivity: z.string().nullable() }), { f: filterOf(filter) })
  if (!exportActivity) throw new Error('no export was started')
  return exportActivity
}
