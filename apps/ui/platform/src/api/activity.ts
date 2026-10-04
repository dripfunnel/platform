import { ApiError, type ExportJob, type PageInfo, type PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'

// The Activity log on the Platform API (FIRST-RELEASE.md §13, §16): what the partner may read is
// the log's own policy (LOGGING.md §6), never anything inside a store or a shopper; the console
// only words each entry's code and facts (LOGGING.md §7).
export const activityWhos = ['team', 'staff', 'setup', 'support', 'events'] as const
export type ActivityWho = (typeof activityWhos)[number]

export const activityResults = ['success', 'denied', 'failed'] as const
export type ActivityResult = (typeof activityResults)[number]

export const datePresets = ['today', '7d', '30d'] as const
export type DatePreset = (typeof datePresets)[number]

export interface ActivityFilter {
  who?: ActivityWho | undefined
  action?: string | undefined
  result?: ActivityResult | undefined
  storeId?: string | undefined
  date?: DatePreset | undefined
}

// The session an entry ran under: a staff member's impersonation or setup, or a partner's support session.
export type Through = 'impersonation' | 'setup_session' | 'support_session'

export interface ActivityEntry {
  id: string
  at: string
  category: string
  action: string
  result: ActivityResult
  actor: { kind: string; id: string | null; label: string | null }
  // The staff member behind an impersonation, as "Name <email>".
  onBehalfOf: string | null
  through: Through | null
  storeId: string | null
  target: { type: string; id: string | null; label: string } | null
  changes: readonly { field: string; before: string | null; after: string | null }[]
  reason: string | null
}

export interface ActivityPage {
  items: readonly ActivityEntry[]
  pageInfo: PageInfo
}

const entrySchema = z.object({
  id: z.string(),
  at: z.string(),
  category: z.string(),
  action: z.string(),
  result: z.enum(activityResults),
  actor: z.object({ kind: z.string(), id: z.string().nullable(), label: z.string().nullable() }),
  onBehalfOf: z.string().nullable(),
  through: z.enum(['impersonation', 'setup_session', 'support_session']).nullable(),
  storeId: z.string().nullable(),
  target: z.object({ type: z.string(), id: z.string().nullable(), label: z.string().nullable() }).nullable().transform((t) => (t && t.label ? { type: t.type, id: t.id, label: t.label } : null)),
  changes: z.array(z.object({ field: z.string(), before: z.string().nullable(), after: z.string().nullable() })).nullable().transform((c) => c ?? []),
  reason: z.string().nullable(),
})

const pageSchema = z.object({
  items: z.array(entrySchema),
  pageInfo: z.object({ startCursor: z.string().nullable(), endCursor: z.string().nullable(), hasPreviousPage: z.boolean(), hasNextPage: z.boolean() }),
})

const entryFields = `items { id at category action result actor { kind id label } onBehalfOf through storeId target { type id label } changes { field before after } reason }
  pageInfo { startCursor endCursor hasPreviousPage hasNextPage }`

// Only the chips the API declares: the ?state= harness and anything else in the address stay out.
const filterOf = (filter: ActivityFilter): ActivityFilter =>
  Object.fromEntries(Object.entries({ who: filter.who, action: filter.action, result: filter.result, storeId: filter.storeId, date: filter.date }).filter(([, value]) => value !== undefined))

export const loadActivity = async (filter: ActivityFilter, page: PageRequest): Promise<ActivityPage> =>
  (
    await query(
      `query Activity($filter: PartnerActivityFilterInput, $after: String, $before: String) { activityLog(filter: $filter, after: $after, before: $before) { ${entryFields} } }`,
      z.object({ activityLog: pageSchema }),
      { filter: filterOf(filter), after: page.after, before: page.before },
    )
  ).activityLog

// `person` is the API's own reference, "team:{id}" or "owner:{id}"; anyone else is refused.
export const loadPersonTimeline = async (person: string, filter: ActivityFilter, page: PageRequest): Promise<ActivityPage> =>
  (
    await query(
      `query Timeline($person: String!, $filter: PartnerActivityFilterInput, $after: String, $before: String) { personTimeline(person: $person, filter: $filter, after: $after, before: $before) { ${entryFields} } }`,
      z.object({ personTimeline: pageSchema }),
      { person, filter: filterOf(filter), after: page.after, before: page.before },
    )
  ).personTimeline

export const peopleMinChars = 2

export interface PersonMatch {
  ref: string
  name: string
  kind: 'team' | 'owner'
  // The team member's role, or the store an Owner owns, already in the API's words.
  detail: string
}

export const findActivityPeople = async (text: string): Promise<PersonMatch[]> =>
  (
    await query(
      `query People($query: String!) { activityPeople(query: $query) { ref name kind detail } }`,
      z.object({ activityPeople: z.array(z.object({ ref: z.string(), name: z.string(), kind: z.enum(['team', 'owner']), detail: z.string() })) }),
      { query: text },
    )
  ).activityPeople

// `exportActivity(filter)` is a job (§16), for Owners and Admins.
export const startActivityExport = async (filter: ActivityFilter): Promise<ExportJob> => {
  const { exportActivity: started } = await query(
    `mutation Export($filter: PartnerActivityFilterInput) { exportActivity(filter: $filter) { ok jobId reason } }`,
    z.object({ exportActivity: z.object({ ok: z.boolean(), jobId: z.string().nullable(), reason: z.string().nullable() }) }),
    { filter: filterOf(filter) },
  )
  if (!started.ok || !started.jobId) throw new ApiError(started.reason ?? 'UNKNOWN', 'The API refused the export.')
  return { id: started.jobId, state: 'preparing', entries: null, url: null, expiresAt: null }
}

const exportLinks = new Map<string, string>()

const exportStates = { queued: 'preparing', done: 'ready', failed: 'failed', too_large: 'tooLarge', expired: 'expired' } as const

export const loadActivityExport = async (id: string): Promise<ExportJob | null> => {
  const { activityExport: job } = await query(
    `query Job($id: ID!) { activityExport(id: $id) { id state rows truncated csv expiresAt } }`,
    z.object({
      activityExport: z.object({ id: z.string(), state: z.enum(['queued', 'done', 'failed', 'too_large', 'expired']), rows: z.number().int().nullable(), truncated: z.boolean().nullable(), csv: z.string().nullable(), expiresAt: z.string().nullable() }).nullable(),
    }),
    { id },
  )
  if (!job) return null
  const state = exportStates[job.state]
  const known = exportLinks.get(job.id)
  if (state !== 'ready' || job.csv === null) {
    if (known) URL.revokeObjectURL(known)
    exportLinks.delete(job.id)
    return { id: job.id, state: state === 'ready' ? 'failed' : state, entries: job.rows, url: null, expiresAt: job.expiresAt, truncated: job.truncated ?? false }
  }
  const url = known ?? URL.createObjectURL(new Blob([job.csv], { type: 'text/csv' }))
  if (!known && job.expiresAt) setTimeout(() => (URL.revokeObjectURL(url), exportLinks.delete(job.id)), Math.max(0, Date.parse(job.expiresAt) - Date.now()))
  exportLinks.set(job.id, url)
  return { id: job.id, state, entries: job.rows, url, expiresAt: job.expiresAt, truncated: job.truncated ?? false }
}
