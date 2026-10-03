// The Activity log on the Admin API (FIRST-RELEASE.md §9, LOGGING.md §6–7): the only place this
// app reads entries, for the Activity log screen and the partner, store and customer tabs.
import { ApiError, type ExportJob, type PageInfo, type PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { activityLevels, type ActionCode, type ActivityLevel } from './activityActions'
import { query } from './client'
import { filterOf, isoString, pageInfoSchema, permissionSchema, refSchema } from './decode'
import type { ActionPermission } from './permissions'

export const actorKinds = ['staff', 'partner_user', 'person', 'customer', 'api_key', 'app_grant', 'support_session', 'job', 'provider', 'anonymous'] as const
export type ActorKind = (typeof actorKinds)[number]

export const activityResults = ['success', 'denied', 'failed'] as const
export type ActivityResult = (typeof activityResults)[number]

export const datePresets = ['today', '7d', '30d'] as const
export type DatePreset = (typeof datePresets)[number]

// Only these have a page in this console, so only these targets are links; the API names others too.
export const linkedTargets = ['partner', 'store', 'customer'] as const
export type TargetType = string

// `target` is "type:id", set by links from a partner, store or customer page (decided on #44).
// `from` and `to` are UTC days, inclusive; either one replaces `date`.
export interface ActivityFilter {
  person?: string | undefined
  actor?: ActorKind | undefined
  level?: ActivityLevel | undefined
  action?: ActionCode | undefined
  result?: ActivityResult | undefined
  partner?: string | undefined
  store?: string | undefined
  customer?: string | undefined
  target?: string | undefined
  date?: DatePreset | undefined
  from?: string | undefined
  to?: string | undefined
  ip?: string | undefined
  imp?: string | undefined
  su?: string | undefined
}

export interface ActivityChange {
  field: string
  before: string | null
  after: string | null
  // A field on the redaction list (LOGGING.md §4.1): recorded as changed, with no values.
  redacted: boolean
}

export const accessKinds = ['impersonation', 'setupSession', 'supportSession'] as const
export type AccessKind = (typeof accessKinds)[number]

export interface ActivityEntry {
  id: string
  occurredAt: string
  // Any code the API recorded; the console words the ones it knows (activityActions.ts).
  action: string
  level: ActivityLevel
  result: ActivityResult
  actor: { kind: ActorKind; id: string | null; label: string }
  onBehalfOf: { id: string; label: string } | null
  access: { kind: AccessKind; id: string } | null
  partner: { id: string; name: string } | null
  store: { id: string; name: string } | null
  target: { type: TargetType; id: string; label: string } | null
  changes: readonly ActivityChange[]
  reason: string | null
  requestId: string
  ip: string | null
  userAgent: string | null
}

export const exportRefusals = ['EXPORTERS_ONLY'] as const
export type ExportRefusal = (typeof exportRefusals)[number]

export interface ActivityPage {
  items: readonly ActivityEntry[]
  pageInfo: PageInfo
  export: ActionPermission<ExportRefusal>
  // The Partner and Store filters' options.
  partners: readonly { id: string; name: string }[]
  stores: readonly { id: string; name: string; partnerId: string }[]
}

export const personKinds = ['staff', 'partner_user', 'person', 'customer'] as const
export type PersonKind = (typeof personKinds)[number]

// `where` tells apart accounts that share a name and an email, one per partner (LOGGING.md §6).
export interface PersonMatch {
  id: string
  name: string
  email: string
  kind: PersonKind
  where: string
}

// `sameEmailAccounts` is a pointer: the timeline still covers this one account (LOGGING.md §6).
export interface ActivityPerson extends PersonMatch {
  memberships: readonly { where: string; role: string }[]
  sameEmailAccounts: number
}

export type ActivityExport = ExportJob

export const activityPageSize = 50
export const exportCap = 100_000
export const exportLinkMinutes = 60
export const peopleMax = 8
export const peopleMinChars = 2

const activityFilterKeys = ['person', 'actor', 'level', 'action', 'result', 'partner', 'store', 'customer', 'target', 'date', 'from', 'to', 'ip', 'imp', 'su'] as const satisfies readonly (keyof ActivityFilter)[]

const named = z.object({ id: z.string(), label: z.string() })

const entrySchema = z.object({
  id: z.string(),
  occurredAt: isoString,
  action: z.string(),
  level: z.enum(activityLevels),
  result: z.enum(activityResults),
  actor: z.object({ kind: z.enum(actorKinds), id: z.string().nullable(), label: z.string() }),
  onBehalfOf: named.nullable(),
  access: z.object({ kind: z.enum(accessKinds), id: z.string() }).nullable(),
  partner: refSchema.nullable(),
  store: refSchema.nullable(),
  target: z.object({ type: z.string(), id: z.string(), label: z.string() }).nullable(),
  changes: z.array(z.object({ field: z.string(), before: z.string().nullable(), after: z.string().nullable(), redacted: z.boolean() })),
  reason: z.string().nullable(),
  requestId: z.string(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
})
const entryFields = `id occurredAt action level result actor { kind id label } onBehalfOf { id label } access { kind id }
  partner { id name } store { id name } target { type id label } changes { field before after redacted } reason requestId ip userAgent`

const pageSchema = z.object({
  activityLog: z.object({
    items: z.array(entrySchema),
    pageInfo: pageInfoSchema,
    export: permissionSchema(exportRefusals),
    partners: z.array(refSchema),
    stores: z.array(z.object({ id: z.string(), name: z.string(), partnerId: z.string() })),
  }),
})

// The whole log as staff see it, or one person's timeline through `person` (FIRST-RELEASE §9).
export const loadActivity = async (filter: ActivityFilter, page: PageRequest): Promise<ActivityPage> =>
  (
    await query(
      `query Activity($filter: ActivityFilter, $after: String, $before: String) {
        activityLog(filter: $filter, after: $after, before: $before) {
          items { ${entryFields} } pageInfo { startCursor endCursor hasPreviousPage hasNextPage }
          export { allowed reason failingChecks } partners { id name } stores { id name partnerId }
        }
      }`,
      pageSchema,
      { filter: filterOf(filter, activityFilterKeys), after: page.after, before: page.before },
    )
  ).activityLog

const match = { id: z.string(), name: z.string(), email: z.string(), kind: z.enum(personKinds), where: z.string() }

export const loadActivityPerson = async (id: string): Promise<ActivityPerson | null> =>
  (
    await query(
      `query Person($person: String!) { activityPerson(person: $person) { id name email kind where memberships { where role } sameEmailAccounts } }`,
      z.object({ activityPerson: z.object({ ...match, memberships: z.array(z.object({ where: z.string(), role: z.string() })), sameEmailAccounts: z.number().int().nonnegative() }).nullable() }),
      { person: id },
    )
  ).activityPerson

export const findActivityPeople = async (term: string): Promise<readonly PersonMatch[]> =>
  (await query(`query People($term: String!) { activityPeople(query: $term) { id name email kind where } }`, z.object({ activityPeople: z.array(z.object(match)) }), { term })).activityPeople

// No storage bucket is bound yet, so the API sends the file inline (THIRD-PARTY-ACCESS §2.1):
// it becomes a link here, made once per job so polling doesn't pile up object URLs.
const links = new Map<string, string>()
const linkFor = (id: string, csv: string | null): string | null => {
  if (csv === null) return null
  const known = links.get(id)
  if (known) return known
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  links.set(id, url)
  return url
}

const jobSchema = z.object({
  activityExport: z.object({ id: z.string(), state: z.enum(['preparing', 'ready', 'expired', 'tooLarge', 'failed']), entries: z.number().int().nonnegative().nullable(), csv: z.string().nullable(), expiresAt: isoString.nullable() }).nullable(),
})

export const loadActivityExport = async (id: string): Promise<ActivityExport | null> => {
  const { activityExport: job } = await query(`query Export($id: ID!) { activityExport(id: $id) { id state entries csv expiresAt } }`, jobSchema, { id })
  return job && { id: job.id, state: job.state, entries: job.entries, url: job.state === 'ready' ? linkFor(job.id, job.csv) : null, expiresAt: job.expiresAt }
}

// Asking is the write (audited); the job is prepared out of the request and polled after.
export const startActivityExport = async (filter: ActivityFilter): Promise<ActivityExport> => {
  const { exportActivity: started } = await query(
    `mutation Export($filter: ActivityFilter) { exportActivity(filter: $filter) { ok jobId reason } }`,
    z.object({ exportActivity: z.object({ ok: z.boolean(), jobId: z.string().nullable(), reason: z.string().nullable() }) }),
    { filter: filterOf(filter, activityFilterKeys) },
  )
  if (!started.ok || !started.jobId) throw new ApiError(started.reason ?? 'UNKNOWN', 'The API refused the export.')
  return { id: started.jobId, state: 'preparing', entries: null, url: null, expiresAt: null }
}
