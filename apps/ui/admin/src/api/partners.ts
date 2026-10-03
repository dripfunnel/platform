// The Partners operations on the Admin API (FIRST-RELEASE.md §4, §12): the only place this app
// talks to the API about partners. The screens only render what these return; in particular
// whether an action is allowed, and why not, is the API's answer (decided on #19).
import { ApiError, type PageInfo, type PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { mutate, outcome, query } from './client'
import { compactActions, hostStatusSchema, isoString, pageInfoSchema, permissionSchema, type HostStatus } from './decode'
import type { SessionPermission } from './sessionRefusals'
import type { ActionPermission as Permission } from './permissions'

export type { HostStatus } from './decode'

export const partnerStates = ['draft', 'awaiting', 'live', 'paused', 'offboarding', 'closed'] as const
export type PartnerState = (typeof partnerStates)[number]

export const setupFilters = ['complete', 'incomplete'] as const
export type SetupFilter = (typeof setupFilters)[number]

export const invitationStatuses = ['active', 'sent', 'held'] as const
export type InvitationStatus = (typeof invitationStatuses)[number]

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
  // Approvals recorded so far; the second one makes the partner live (§4.3).
  approvals: number
}

export interface PartnerRow {
  id: string
  name: string
  house: boolean
  kind: string | null
  region: string | null
  state: PartnerState
  stores: number
  portalHost: { host: string | null; status: HostStatus }
  setup: { done: number; total: number }
  // No owner yet means no email and no invitation, which a brand-new draft can be.
  owner: { name: string | null; email: string | null; invitation: InvitationStatus | null; invitationSentAt: string | null }
  createdAt: string
  submittedAt: string | null
  checks: Record<GoLiveCheck, boolean>
  // Only while the partner is awaiting approval.
  approval: PartnerApproval | null
}

export const partnerActions = ['approve', 'sendBack', 'pause', 'resume', 'setupSession', 'sendInvite', 'resendInvite'] as const
export type PartnerAction = (typeof partnerActions)[number]

// Stable codes the API gives for a refusal (apps/api/src/saas/partners/service.ts); the words
// for each are in messages/en.json. Failing go-live checks come with the checks themselves.
export const partnerRefusals = [
  'SUPER_ADMIN_ONLY',
  'PARTNER_ADMINS_ONLY',
  'INVITERS_ONLY',
  'NOT_ASSIGNED',
  'HOUSE_PARTNER',
  'SET_UP_BY_CALLER',
  'ALREADY_APPROVED_BY_CALLER',
  'STAFF_ROLE_NOT_ALLOWED',
] as const
export type RefusalCode = (typeof partnerRefusals)[number] | 'GO_LIVE_CHECKS_FAILING'

export type ActionPermission = Permission<(typeof partnerRefusals)[number]> | { allowed: false; reason: 'GO_LIVE_CHECKS_FAILING'; failingChecks: readonly GoLiveCheck[] }

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

// Cursor paged with no total (FIRST-RELEASE.md §12); the server caps the page.
export interface PartnerPage {
  items: readonly PartnerRow[]
  pageInfo: PageInfo
  // Whether the caller may create a partner: the button's state on the list.
  create: ActionPermission
}

// The ten setup items of DATA-MODEL.md §3.2, in the API's words.
export const setupItems = ['company', 'branding', 'portalHost', 'wildcards', 'emailSender', 'plan', 'legal', 'paymentMethod', 'payoutDetails', 'testSignup'] as const
export type SetupItem = (typeof setupItems)[number]

export interface SetupRow {
  item: SetupItem
  status: 'done' | 'progress' | 'missing'
  // The API's plain-words line for the item, such as which host is live or what is still missing.
  detail: string | null
  by: { name: string; org: string } | null
}

// `action` is the activity log's code for the event (LOGGING.md §4), which messages/ words.
export interface HistoryEntry {
  at: string
  action: string
  by: string | null
  note: string | null
}

export const domainKinds = ['portal', 'preview', 'shops', 'email'] as const
export type DomainKind = (typeof domainKinds)[number]

export interface PartnerDomain {
  id: string
  kind: DomainKind
  host: string
  status: Exclude<HostStatus, 'notSet'>
  record: string
  expected: string
  found: string | null
  checkedAt: string | null
}

export const planStatuses = ['draft', 'live', 'retired'] as const
export type PlanStatus = (typeof planStatuses)[number]

// No price yet: plans are priced on their own card (decided on #33).
export interface PartnerPlan {
  id: string
  name: string
  status: PlanStatus
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
  status: 'active' | 'invited' | 'suspended'
  lastSignInAt: string | null
}

export interface Partner extends PartnerRow {
  country: string | null
  contacts: readonly { name: string; role: string; email: string }[]
  history: readonly HistoryEntry[]
  checklist: readonly SetupRow[]
  branding: { productName: string | null; primaryColor: string | null; accentColor: string | null; poweredBy: 'on' | 'off' | 'house' }
  domains: readonly PartnerDomain[]
  plans: readonly PartnerPlan[]
  team: readonly PartnerUser[]
  // Whether the caller may impersonate each team member, by their id (ACCESS.md §8.1). The
  // API gives none until #40, so nothing is offered.
  impersonate: Readonly<Record<string, SessionPermission>>
  actions: PartnerPermissions
}

const permission = permissionSchema(partnerRefusals)

const goLivePermission = z
  .object({ allowed: z.boolean(), reason: z.string().nullable(), failingChecks: z.array(z.enum(goLiveChecks)).nullable() })
  .transform((p, ctx): ActionPermission => {
    if (!p.allowed && p.reason === 'GO_LIVE_CHECKS_FAILING') return { allowed: false, reason: 'GO_LIVE_CHECKS_FAILING', failingChecks: p.failingChecks ?? [] }
    const parsed = permission.safeParse(p)
    if (!parsed.success) {
      ctx.addIssue({ code: 'custom', message: `unknown refusal ${p.reason ?? 'null'}` })
      return z.NEVER
    }
    return parsed.data
  })

const owner = z.object({
  name: z.string().nullable(),
  email: z.string().nullable(),
  invitation: z.enum(invitationStatuses).nullable(),
  invitationSentAt: isoString.nullable(),
})

const approval = z.object({ setUpBy: z.string().nullable(), rule: z.enum(['alone', 'second', 'two']), approvals: z.number().int().nonnegative() }).nullable()

const checks = z.object(Object.fromEntries(goLiveChecks.map((check) => [check, z.boolean()])) as Record<GoLiveCheck, z.ZodBoolean>)

const rowFields = {
  id: z.string(),
  name: z.string(),
  house: z.boolean(),
  kind: z.string().nullable(),
  region: z.string().nullable(),
  state: z.enum(partnerStates),
  stores: z.number().int().nonnegative(),
  portalHost: z.object({ host: z.string().nullable(), status: hostStatusSchema.nullable() }).transform((p) => ({ host: p.host, status: p.status ?? ('notSet' as const) })),
  setup: z.object({ done: z.number().int(), total: z.number().int() }),
  owner,
  createdAt: isoString,
  submittedAt: isoString.nullable(),
  checks,
  approval,
}

const rowSchema = z.object(rowFields)

// The API's role keys for a partner user (ACCESS.md §5.3), shared with the staff-session decoders.
export const partnerRoleOfKey: Record<string, PartnerUserRole> = {
  'partner-owner': 'owner',
  'partner-admin': 'admin',
  'partner-support': 'support',
  'partner-finance': 'finance',
  'partner-read-only': 'readOnly',
}

const teamMember = z
  .object({ id: z.string(), name: z.string(), email: z.string(), role: z.string(), status: z.enum(['active', 'invited', 'suspended']), lastSignInAt: isoString.nullable() })
  .transform((u, ctx): PartnerUser => {
    const role = partnerRoleOfKey[u.role]
    if (!role) {
      ctx.addIssue({ code: 'custom', message: `unknown partner role ${u.role}` })
      return z.NEVER
    }
    return { ...u, role }
  })

const partnerSchema = z.object({
  ...rowFields,
  country: z.string().nullable(),
  contacts: z.array(z.object({ name: z.string(), role: z.string(), email: z.string() })),
  history: z.array(z.object({ at: isoString, action: z.string(), by: z.string().nullable(), note: z.string().nullable() })),
  checklist: z.array(
    z.object({ item: z.enum(setupItems), status: z.enum(['done', 'progress', 'missing']), detail: z.string().nullable(), by: z.object({ name: z.string(), org: z.string() }).nullable() }),
  ),
  branding: z.object({ productName: z.string().nullable(), primaryColor: z.string().nullable(), accentColor: z.string().nullable(), poweredBy: z.enum(['on', 'off', 'house']) }),
  domains: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(domainKinds),
      host: z.string(),
      status: hostStatusSchema.exclude(['notSet']),
      record: z.string(),
      expected: z.string(),
      found: z.string().nullable(),
      checkedAt: isoString.nullable(),
    }),
  ),
  plans: z.array(z.object({ id: z.string(), name: z.string(), status: z.enum(planStatuses), maxProducts: z.number().int().nullable(), maxStaff: z.number().int().nullable(), stores: z.number().int() })),
  team: z.array(teamMember),
  actions: z.object({
    approve: goLivePermission.nullable(),
    sendBack: permission.nullable(),
    pause: permission.nullable(),
    resume: permission.nullable(),
    setupSession: permission.nullable(),
    sendInvite: permission.nullable(),
    resendInvite: permission.nullable(),
  }),
})

const rowSelection = `id name house kind region state stores portalHost { host status } setup { done total }
  owner { name email invitation invitationSentAt } createdAt submittedAt
  checks { portalHost emailDomain legalPages pricedPlan testSignup } approval { setUpBy rule approvals }`

const permissionSelection = `{ allowed reason failingChecks }`

const partnersQuery = `query Partners($filter: PartnerFilter, $after: String, $before: String) {
  partners(filter: $filter, after: $after, before: $before) {
    items { ${rowSelection} }
    pageInfo { startCursor endCursor hasPreviousPage hasNextPage }
    create ${permissionSelection}
  }
}`

const partnerQuery = `query Partner($id: ID!) {
  partner(id: $id) {
    ${rowSelection}
    country contacts { name role email }
    history { at action by note }
    checklist { item status detail by { name org } }
    branding { productName primaryColor accentColor poweredBy }
    domains { id kind host status record expected found checkedAt }
    plans { id name status maxProducts maxStaff stores }
    team { id name email role status lastSignInAt }
    actions {
      approve ${permissionSelection} sendBack ${permissionSelection} pause ${permissionSelection} resume ${permissionSelection}
      setupSession ${permissionSelection} sendInvite ${permissionSelection} resendInvite ${permissionSelection}
    }
  }
}`

export const loadPartners = async (filter: PartnerFilter, page: PageRequest): Promise<PartnerPage> => {
  const { partners } = await query(partnersQuery, z.object({ partners: z.object({ items: z.array(rowSchema), pageInfo: pageInfoSchema, create: permission }) }), {
    // The URL says `status` (ui/README.md §6); the API's filter calls it `state`.
    filter: { state: filter.status, setup: filter.setup, q: filter.q, sort: filter.sort },
    after: page.after,
    before: page.before,
  })
  return partners
}

// Null when there is no such partner. A partner outside the caller's assignment is refused
// with FORBIDDEN, which the route's error view words (ui/README.md §5).
export const loadPartner = async (id: string): Promise<Partner | null> => {
  const { partner } = await query(partnerQuery, z.object({ partner: partnerSchema.nullable() }), { id })
  return partner && { ...partner, impersonate: {}, actions: compactActions(partner.actions) }
}

// Every action but the invitations changes the partner's business, so the API refuses it
// without a reason (decided on #19). A refusal arrives as an ApiError with the API's code.
export const runPartnerAction = async (id: string, action: Exclude<PartnerAction, 'setupSession'>, reason: string | null): Promise<void> => {
  const withReason = (field: string) => mutate(field, `${field}(id: $id, reason: $reason)`, '($id: ID!, $reason: String!)', { id, reason: reason ?? '' })
  const plain = (field: string) => mutate(field, `${field}(id: $id)`, '($id: ID!)', { id })
  switch (action) {
    case 'approve':
      await withReason('approvePartner')
      return
    case 'sendBack':
      await withReason('sendBackPartner')
      return
    case 'pause':
      await withReason('pausePartner')
      return
    case 'resume':
      await withReason('resumePartner')
      return
    case 'sendInvite':
      await plain('sendPartnerOwnerInvite')
      return
    case 'resendInvite':
      await plain('resendPartnerOwnerInvite')
      return
  }
}

// Queues the check; the row updates once it has run (FIRST-RELEASE.md §12), so there is no
// new status to return yet.
export const recheckDomain = async (id: string, kind: DomainKind): Promise<void> => {
  await mutate('recheckDomain', 'recheckDomain(id: $id, kind: $kind)', '($id: ID!, $kind: String!)', { id, kind })
}

// Whether the caller may create a partner: the same answer the list's button shows.
export const loadCreatePermission = async (): Promise<ActionPermission> => {
  const { partners } = await query(`query PartnerCreatePermission { partners(first: 1) { create ${permissionSelection} } }`, z.object({ partners: z.object({ create: permission }) }))
  return partners.create
}

export interface NewPartner {
  name: string
  ownerEmail: string
  country: string
  // False holds the Owner invitation until someone sends it from the partner's page (§4.3).
  sendInvitation: boolean
}

const createdSchema = z.object({ createPartner: z.object({ ok: z.boolean(), code: z.string().nullable(), id: z.string().nullable() }) })

// The new partner's id; a refusal arrives as an ApiError with the API's code, NAME_TAKEN among them.
export const createPartner = async (input: NewPartner): Promise<string> => {
  const { createPartner: result } = await query(`mutation CreatePartner($input: CreatePartnerInput!) { createPartner(input: $input) { ok code id } }`, createdSchema, { input })
  const { id } = outcome(result)
  if (id === null) throw new ApiError('BAD_RESPONSE', 'createPartner succeeded without an id.')
  return id
}
