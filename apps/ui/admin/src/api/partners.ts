// The Partners operations on the Admin API (FIRST-RELEASE.md §4, §12): the only place this app
// talks to the API about partners. The screens only render what these return; in particular
// whether an action is allowed, and why not, is the API's answer (decided on #19).
import type { Money } from '@dripfunnel/shared/format'
import { harnessEnabled } from '../harness'
import type { PageInfo, PageRequest } from './pageInfo'
import type { ActionPermission as Permission } from './permissions'
import type { StaffRole } from '../features/shell/staffRoles'
import type { SessionPermission } from './impersonation'
import { sampleServer } from './partnersSample'

export const partnerStates = ['draft', 'awaiting', 'live', 'paused', 'offboarding', 'closed'] as const
export type PartnerState = (typeof partnerStates)[number]

export const setupFilters = ['complete', 'incomplete'] as const
export type SetupFilter = (typeof setupFilters)[number]

export type HostStatus = 'live' | 'waiting' | 'failed' | 'notSet'
export type InvitationStatus = 'active' | 'sent' | 'held'

export const goLiveChecks = ['portalHost', 'emailDomain', 'pricedPlan', 'legalPages', 'testSignup'] as const
export type GoLiveCheck = (typeof goLiveChecks)[number]

// Who has to approve a submitted partner (FIRST-RELEASE.md §4.3): a Super admin who ran the
// setup approves it alone, anyone else who did needs a second approver, and a partner that set
// itself up needs two. `setUpBy` is the staff member who ran the setup session, never called
// a reviewer, because they may not be the sole approver (decided on #43).
export type ApproverRule = 'alone' | 'second' | 'two'

export interface PartnerApproval {
  setUpBy: string | null
  rule: ApproverRule
}

export interface PartnerRow {
  id: string
  name: string
  house: boolean
  kind: string
  region: string
  state: PartnerState
  stores: number
  portalHost: { host: string | null; status: HostStatus }
  setup: { done: number; total: number }
  owner: { name: string | null; email: string; invitation: InvitationStatus; invitationSentAt: string | null }
  createdAt: string
  submittedAt: string | null
  checks: Record<GoLiveCheck, boolean>
  // Only while the partner is awaiting approval.
  approval: PartnerApproval | null
}

export const partnerActions = ['approve', 'sendBack', 'pause', 'resume', 'setupSession', 'sendInvite', 'resendInvite'] as const
export type PartnerAction = (typeof partnerActions)[number]

// Stable codes the API gives for a refusal; the words for each are in messages/en.json.
export type RefusalCode =
  | 'SUPER_ADMIN_ONLY'
  | 'PARTNER_ADMINS_ONLY'
  | 'INVITERS_ONLY'
  | 'HOUSE_PARTNER'
  | 'GO_LIVE_CHECKS_FAILING'
  | 'SET_UP_BY_CALLER'

export type ActionPermission =
  | Permission<Exclude<RefusalCode, 'GO_LIVE_CHECKS_FAILING'>>
  | { allowed: false; reason: 'GO_LIVE_CHECKS_FAILING'; failingChecks: readonly GoLiveCheck[] }

// An action missing from the block isn't offered for this partner in its state; one that is
// present but refused is shown disabled with its reason (ui/README.md §5, consoles).
export type PartnerPermissions = Partial<Record<PartnerAction, ActionPermission>>


export interface PartnerFilter {
  status?: PartnerState | undefined
  setup?: SetupFilter | undefined
  q?: string | undefined
  // Approvals asks for the oldest submitted first (FIRST-RELEASE.md §6); the list is newest first.
  sort?: 'oldestSubmitted' | undefined
}

export interface PartnerPage {
  items: readonly PartnerRow[]
  pageInfo: PageInfo
  total: number
  // Whether the caller may create a partner: the button's state on the list.
  create: ActionPermission
}

export type SetupItem =
  | 'companyDetails'
  | 'ownerAccepted'
  | 'branding'
  | 'portalHost'
  | 'emailSender'
  | 'plans'
  | 'legalPages'
  | 'payoutDetails'

export interface SetupRow {
  item: SetupItem
  status: 'done' | 'waitingForDns' | 'notStarted' | 'waitingOnPartner' | 'invitationSent' | 'invitationHeld'
  by: { name: string; org: string } | null
}

export type HistoryEvent = 'created' | 'submitted' | 'sentBack' | 'approved' | 'paused' | 'resumed' | 'setUp'

export interface HistoryEntry {
  at: string
  event: HistoryEvent
  by: string | null
  note: string | null
}

export type DomainKind = 'portal' | 'preview' | 'shops' | 'email'

export interface PartnerDomain {
  kind: DomainKind
  host: string
  status: Exclude<HostStatus, 'notSet'>
  record: string
  expected: string
  found: string | null
}

export interface PartnerPlan {
  id: string
  name: string
  // Null while the partner hasn't priced it; an amount of 0 is a free plan.
  price: Money | null
  maxProducts: number | null
  maxStaff: number | null
  stores: number
}

export type PartnerUserRole = 'owner' | 'admin' | 'support' | 'finance' | 'readOnly'

export interface PartnerUser {
  id: string
  name: string
  email: string
  role: PartnerUserRole
  status: 'active' | 'invited'
  lastSignInAt: string | null
}

export interface Partner extends PartnerRow {
  country: string
  contacts: readonly { name: string; role: string; email: string }[]
  history: readonly HistoryEntry[]
  checklist: readonly SetupRow[]
  branding: { productName: string; primaryColor: string; accentColor: string; poweredBy: 'on' | 'off' | 'house' }
  domains: readonly PartnerDomain[]
  plans: readonly PartnerPlan[]
  team: readonly PartnerUser[]
  // Whether the caller may impersonate each team member, by their id (ACCESS.md §8.1).
  impersonate: Readonly<Record<string, SessionPermission>>
  actions: PartnerPermissions
}

// The API's cap on a page; it answers with fewer when there are fewer.
export const partnerPageSize = 25

const notConnected = () => Promise.reject(new Error('The Admin API has no partners queries yet (#33).'))

// Seam: replace the sample with the Admin API's `partners(filter, after)` and `partner(id)`
// queries and the §12 mutations through createApiClient from @dripfunnel/shared/graphql once
// #33 lands (https://github.com/dripfunnel/platform/issues/33). `caller` stands in for the
// session the API reads the staff role from, and goes with the sample. The sample is invented,
// so it appears only where the ?state= harness does; a production build shows the error state.
export const loadPartners = (filter: PartnerFilter, page: PageRequest, caller: StaffRole): Promise<PartnerPage> =>
  harnessEnabled ? Promise.resolve(sampleServer.list(filter, page, partnerPageSize, caller)) : notConnected()

export const loadPartner = (id: string, caller: StaffRole): Promise<Partner | null> =>
  harnessEnabled ? Promise.resolve(sampleServer.get(id, caller)) : notConnected()

// Every action but the invitations changes the partner's business, so the API refuses it
// without a reason (decided on #19).
export const runPartnerAction = (id: string, action: PartnerAction, reason: string | null): Promise<void> =>
  harnessEnabled ? Promise.resolve(sampleServer.run(id, action, reason)) : notConnected()

export const recheckDomain = (id: string, kind: DomainKind): Promise<PartnerDomain['status']> =>
  harnessEnabled ? Promise.resolve(sampleServer.recheck(id, kind)) : notConnected()
