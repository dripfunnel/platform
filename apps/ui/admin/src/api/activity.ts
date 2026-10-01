// The Activity log on the Admin API (FIRST-RELEASE.md §9, LOGGING.md §6–7): the only place this
// app reads entries, for the Activity log screen and the partner, store and customer tabs.
import type { StaffRole } from '../features/shell/staffRoles'
import type { ActionCode, ActivityLevel } from './activityActions'
import { activityServer } from './activitySample'
import type { PageInfo, PageRequest } from './pageInfo'
import type { ActionPermission } from './permissions'
import { harnessEnabled } from '../harness'

export const actorKinds = ['staff', 'partner_user', 'person', 'customer', 'api_key', 'app_grant', 'support_session', 'job', 'provider', 'anonymous'] as const
export type ActorKind = (typeof actorKinds)[number]

export const activityResults = ['success', 'denied', 'failed'] as const
export type ActivityResult = (typeof activityResults)[number]

export const datePresets = ['today', '7d', '30d'] as const
export type DatePreset = (typeof datePresets)[number]

// Only these have a page in this console, so only these targets are links.
export const linkedTargets = ['partner', 'store', 'customer'] as const
export type TargetType = (typeof linkedTargets)[number] | 'product' | 'order' | 'plan' | 'staff' | 'job' | 'api_key' | 'domain' | 'export'

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

export type AccessKind = 'impersonation' | 'setupSession' | 'supportSession'

export interface ActivityEntry {
  id: string
  occurredAt: string
  action: ActionCode
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

export type ExportRefusal = 'EXPORTERS_ONLY'

export interface ActivityPage {
  items: readonly ActivityEntry[]
  pageInfo: PageInfo
  export: ActionPermission<ExportRefusal>
  // The Partner and Store filters' options.
  partners: readonly { id: string; name: string }[]
  stores: readonly { id: string; name: string; partnerId: string }[]
}

export type PersonKind = 'staff' | 'partner_user' | 'person' | 'customer'

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

export type ExportState = 'preparing' | 'ready' | 'expired' | 'tooLarge' | 'failed'

export interface ActivityExport {
  id: string
  state: ExportState
  entries: number | null
  url: string | null
  expiresAt: string | null
}

export const activityPageSize = 50
export const exportCap = 100_000
export const exportLinkMinutes = 60
export const peopleMax = 8
export const peopleMinChars = 2

const notConnected = () => Promise.reject(new Error('The Admin API has no activity queries yet (#38).'))

// Seam: #68 replaces the sample with `activityLog`, `personTimeline`, `activityPeople`, `exportActivity`
// and `activityExport` from #38 (https://github.com/dripfunnel/platform/issues/38). `caller` goes with it.
export const loadActivity = (filter: ActivityFilter, page: PageRequest, caller: StaffRole): Promise<ActivityPage> =>
  harnessEnabled ? Promise.resolve(activityServer.list(filter, page, activityPageSize, caller)) : notConnected()

export const loadActivityPerson = (id: string): Promise<ActivityPerson | null> =>
  harnessEnabled ? Promise.resolve(activityServer.person(id)) : notConnected()

export const findActivityPeople = (query: string): Promise<readonly PersonMatch[]> =>
  harnessEnabled ? Promise.resolve(activityServer.people(query, peopleMax)) : notConnected()

export const startActivityExport = (filter: ActivityFilter, caller: StaffRole): Promise<ActivityExport> =>
  harnessEnabled ? Promise.resolve(activityServer.startExport(filter, caller)) : notConnected()

export const loadActivityExport = (id: string): Promise<ActivityExport | null> =>
  harnessEnabled ? Promise.resolve(activityServer.exportJob(id)) : notConnected()
