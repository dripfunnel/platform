// Staff sessions on the Admin API (ACCESS.md §8.1, §8.2; FIRST-RELEASE.md §8): impersonating a
// partner or store user, and setup sessions. The only place this app talks to the API about them.
import { ApiError, type PageInfo, type PageRequest } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { isApiError, query } from './client'
import { compactActions, filterOf, isoString, pageInfoSchema, permissionSchema, refSchema } from './decode'
import { partnerRoleOfKey, type PartnerUserRole } from './partners'
import { sessionRefusals, type SessionPermission, type SessionRefusal } from './sessionRefusals'
import { storeRoleOfKey, type StoreUser } from './stores'

export { sessionRefusals, type SessionPermission, type SessionRefusal } from './sessionRefusals'

export const targetKinds = ['partnerUser', 'storeUser', 'supplierUser'] as const
export type TargetKind = (typeof targetKinds)[number]

export const targetStatuses = ['active', 'invited', 'suspended'] as const
export type TargetStatus = (typeof targetStatuses)[number]

export interface Ref {
  id: string
  name: string
}

// Where a user can be acted as: their partner's console, or one store (and one supplier there).
export type Membership =
  | { id: string; level: 'partner'; partner: Ref; role: PartnerUserRole }
  | { id: string; level: 'store'; partner: Ref; store: Ref; role: StoreUser['role']; supplier: string | null }

export type MembershipRole = Membership['role']

// The place a session acts in: a membership as the session names it, without a membership id.
export type SessionMembership = Membership extends infer M ? (M extends Membership ? Omit<M, 'id'> : never) : never

export const membershipRoles = ['owner', 'admin', 'support', 'finance', 'readOnly', 'manager', 'staff', 'supplierAdmin', 'supplierMember'] as const satisfies readonly MembershipRole[]

export interface ImpersonationTarget {
  id: string
  name: string
  email: string
  kind: TargetKind
  memberships: readonly Membership[]
  lastSignInAt: string | null
  status: TargetStatus
  impersonate: SessionPermission
  // The caller's own open session as this user, which Impersonate returns to instead.
  openSession: string | null
}

export interface TargetFilter {
  type?: TargetKind | undefined
  partner?: string | undefined
  store?: string | undefined
  role?: MembershipRole | undefined
  status?: TargetStatus | undefined
}

export interface TargetPage {
  items: readonly ImpersonationTarget[]
  pageInfo: PageInfo
  partners: readonly Ref[]
  stores: readonly (Ref & { partnerId: string })[]
}

export const sessionKinds = ['impersonation', 'setup'] as const
export type SessionKind = (typeof sessionKinds)[number]

export type SessionOutcome = 'open' | 'expired' | 'endedByStaff' | 'endedFromPortal' | 'targetGone' | 'partnerClosed'

export type SessionAction = 'end' | 'extend' | 'return'

// Never the handoff token: that exists only in the link that opens the portal (ACCESS.md §8.1).
export interface StaffSession {
  id: string
  kind: SessionKind
  staff: Ref
  target: Ref | null
  membership: SessionMembership | null
  partner: Ref
  store: Ref | null
  host: string
  reason: string
  ticket: string | null
  startedAt: string
  expiresAt: string
  endedAt: string | null
  extendedAt: string | null
  outcome: SessionOutcome
  mine: boolean
  actions: Partial<Record<SessionAction, SessionPermission>>
}

export const sessionDates = ['today', '7d', '30d'] as const
export type SessionDate = (typeof sessionDates)[number]

export interface SessionFilter {
  kind?: SessionKind | undefined
  staff?: string | undefined
  partner?: string | undefined
  store?: string | undefined
  date?: SessionDate | undefined
}

export interface SessionPage {
  open: readonly StaffSession[]
  history: { items: readonly StaffSession[]; pageInfo: PageInfo }
  staff: readonly Ref[]
  partners: readonly Ref[]
  stores: readonly Ref[]
}

export type StartResult = { ok: true; session: StaffSession; handoff: string } | { ok: false; reason: SessionRefusal }
// A role that can't open a session is told so, not shown a missing page (decided on #46).
export type SessionLookup = { kind: 'found'; session: StaffSession } | { kind: 'denied' } | { kind: 'notFound' }

export type SessionResult = { ok: true } | { ok: false; reason: SessionRefusal }

// A fresh sign-in with the company SSO (CONSOLE-DESIGN A2): the API stamps the session, so nothing comes back but the outcome.
export type Reauth = { ok: true } | { ok: false; outcome: 'failed' | 'cancelled' }

export const impersonationMinutes = 30
export const setupSessionMinutes = 120
export const targetPageSize = 25
export const sessionPageSize = 25

const permission = permissionSchema(sessionRefusals)

// The API sends role keys; the console's words are keyed by its own names (partners.ts, stores.ts).
const roleOf = (level: Membership['level'], key: string): MembershipRole | undefined => (level === 'partner' ? partnerRoleOfKey[key] : storeRoleOfKey[key])

const membershipSchema = z
  .object({ id: z.string(), level: z.enum(['partner', 'store']), partner: refSchema, store: refSchema.nullable(), role: z.string(), supplier: z.string().nullable() })
  .transform((m, ctx): Membership => {
    const role = roleOf(m.level, m.role)
    if (m.level === 'partner' && role && role in partnerRoleNames) return { id: m.id, level: 'partner', partner: m.partner, role: role as PartnerUserRole }
    if (m.level === 'store' && role && m.store) return { id: m.id, level: 'store', partner: m.partner, store: m.store, role: role as StoreUser['role'], supplier: m.supplier }
    ctx.addIssue({ code: 'custom', message: `unknown membership ${m.level} ${m.role}` })
    return z.NEVER
  })
const partnerRoleNames: Record<PartnerUserRole, true> = { owner: true, admin: true, support: true, finance: true, readOnly: true }

const targetSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  kind: z.enum(targetKinds),
  memberships: z.array(membershipSchema),
  lastSignInAt: isoString.nullable(),
  status: z.enum(targetStatuses),
  impersonate: permission,
  openSession: z.string().nullable(),
})
const targetFields = 'id name email kind memberships { id level partner { id name } store { id name } role supplier } lastSignInAt status impersonate { allowed reason failingChecks } openSession'

// The filter goes out as the API's role key, the way memberships come in. `owner` names a partner
// Owner only with the Partner user type: one key can't select both kinds of owner (#68's findings).
const partnerKeys = Object.fromEntries(Object.entries(partnerRoleOfKey).map(([key, role]) => [role, key])) as Record<PartnerUserRole, string>
const storeKeys = Object.fromEntries(Object.entries(storeRoleOfKey).map(([key, role]) => [role, key])) as Record<StoreUser['role'], string>
export const roleKeyOf = (role: MembershipRole, type: TargetKind | undefined): string =>
  role === 'owner' ? (type === 'partnerUser' ? partnerKeys.owner : storeKeys.owner) : role in partnerKeys ? partnerKeys[role as PartnerUserRole] : storeKeys[role as StoreUser['role']]

// What a role may not list is the API's FORBIDDEN: the page's no-access view, not an error.
const orDenied = async <T>(load: Promise<T>): Promise<T | null> => {
  try {
    return await load
  } catch (error) {
    if (isApiError(error, 'FORBIDDEN')) return null
    throw error
  }
}

// The search term travels in the POST body, never a URL. The API sends no store list for the
// Store filter yet, so it offers none (#68's findings).
export const loadTargets = (filter: TargetFilter, page: PageRequest, search: string | null): Promise<TargetPage | null> =>
  orDenied(
    query(
      `query Targets($filter: ImpersonationTargetFilter, $search: String, $after: String, $before: String) {
        impersonationTargets(filter: $filter, search: $search, after: $after, before: $before) {
          items { ${targetFields} } pageInfo { startCursor endCursor hasPreviousPage hasNextPage } partners { id name }
        }
      }`,
      z.object({ impersonationTargets: z.object({ items: z.array(targetSchema), pageInfo: pageInfoSchema, partners: z.array(refSchema) }) }),
      { filter: { ...filterOf(filter, ['type', 'partner', 'store', 'status']), ...(filter.role ? { role: roleKeyOf(filter.role, filter.type) } : {}) }, search, after: page.after, before: page.before },
    ).then(({ impersonationTargets: found }) => ({ ...found, stores: [] })),
  )

export interface TargetPlace {
  email: string
  partner?: string | undefined
  store?: string | undefined
}

// How far a lookup pages before it gives up: an email matches a handful of accounts in one place.
const lookupPages = 10

// The person picked on a partner's Team tab or a store's Users tab: found by their email in that
// place, then by the membership picked, page by page (the API has no lookup by membership).
export const loadTarget = async (membershipId: string, place: TargetPlace): Promise<ImpersonationTarget | null> => {
  if (place.email.trim() === '') return null
  let after: string | undefined
  for (let page = 0; page < lookupPages; page += 1) {
    const found = await loadTargets({ partner: place.partner, store: place.store }, after ? { after } : {}, place.email)
    const target = found?.items.find((candidate) => candidate.memberships.some((membership) => membership.id === membershipId))
    if (target) return target
    if (!found?.pageInfo.hasNextPage || !found.pageInfo.endCursor) return null
    after = found.pageInfo.endCursor
  }
  return null
}

const sessionSchema = z
  .object({
    id: z.string(),
    kind: z.enum(sessionKinds),
    staff: refSchema,
    target: refSchema.nullable(),
    membership: z.object({ role: z.string(), supplier: z.string().nullable() }).nullable(),
    partner: refSchema,
    store: refSchema.nullable(),
    host: z.string(),
    reason: z.string(),
    ticket: z.string().nullable(),
    startedAt: isoString,
    expiresAt: isoString,
    endedAt: isoString.nullable(),
    extendedAt: isoString.nullable(),
    outcome: z.enum(['open', 'expired', 'endedByStaff', 'endedFromPortal', 'targetGone', 'partnerClosed']),
    mine: z.boolean(),
    actions: z.object({ end: permission.nullable(), extend: permission.nullable(), return: permission.nullable() }),
  })
  .transform((s): StaffSession => {
    // The session names its place; the membership adds only the role there and the supplier.
    const level = s.store ? 'store' : 'partner'
    const role = s.membership ? roleOf(level, s.membership.role) : undefined
    const membership: SessionMembership | null =
      !s.membership || !role
        ? null
        : s.store
          ? { level: 'store', partner: s.partner, store: s.store, role: role as StoreUser['role'], supplier: s.membership.supplier }
          : { level: 'partner', partner: s.partner, role: role as PartnerUserRole }
    return { ...s, membership, actions: compactActions(s.actions) }
  })
const sessionFields = `id kind staff { id name } target { id name } membership { role supplier } partner { id name } store { id name } host reason ticket
  startedAt expiresAt endedAt extendedAt outcome mine actions { end { allowed reason failingChecks } extend { allowed reason failingChecks } return { allowed reason failingChecks } }`

// The API sends no staff or store lists for the filters yet, so they offer none (#68's findings).
export const loadSessions = (filter: SessionFilter, page: PageRequest): Promise<SessionPage | null> =>
  orDenied(
    query(
      `query Sessions($filter: StaffSessionFilter, $after: String, $before: String) {
        staffSessions(filter: $filter, after: $after, before: $before) {
          open { ${sessionFields} } history { items { ${sessionFields} } pageInfo { startCursor endCursor hasPreviousPage hasNextPage } } partners { id name }
        }
      }`,
      z.object({ staffSessions: z.object({ open: z.array(sessionSchema), history: z.object({ items: z.array(sessionSchema), pageInfo: pageInfoSchema }), partners: z.array(refSchema) }) }),
      { filter: filterOf(filter, ['kind', 'staff', 'partner', 'store', 'date']), after: page.after, before: page.before },
    ).then(({ staffSessions }) => ({ ...staffSessions, staff: [], stores: [] })),
  )

export const loadSession = async (id: string): Promise<SessionLookup> => {
  const { staffSession } = await query(
    `query Session($id: ID!) { staffSession(id: $id) { kind session { ${sessionFields} } } }`,
    z.object({ staffSession: z.object({ kind: z.enum(['found', 'denied', 'notFound']), session: sessionSchema.nullable() }) }),
    { id },
  )
  return staffSession.kind === 'found' && staffSession.session ? { kind: 'found', session: staffSession.session } : { kind: staffSession.kind === 'denied' ? 'denied' : 'notFound' }
}

// A role that may open no session has none: the strip stays empty rather than failing.
export const loadMySessions = async (): Promise<readonly StaffSession[]> =>
  (await orDenied(query(`{ myStaffSessions { ${sessionFields} } }`, z.object({ myStaffSessions: z.array(sessionSchema) }))))?.myStaffSessions ?? []

// A code this console doesn't know is an error with that code, so it is never worded as a known one.
const refusalOf = (reason: string | null): SessionRefusal => {
  const known = z.enum(sessionRefusals).safeParse(reason)
  if (!known.success) throw new ApiError(reason ?? 'UNKNOWN', 'The API refused the session with a code this console does not know.')
  return known.data
}

const startSchema = z.object({ ok: z.boolean(), reason: z.string().nullable(), handoff: z.string().nullable(), session: sessionSchema.nullable() })

const started = (result: z.infer<typeof startSchema>): StartResult =>
  result.ok && result.session && result.handoff ? { ok: true, session: result.session, handoff: result.handoff } : { ok: false, reason: refusalOf(result.reason) }

// Re-authentication is a stamp on the staff session, fresh for five minutes (ACCESS.md §8.1):
// the API answers REAUTH_REQUIRED without one, and the dialog asks for a new sign-in.
export const startImpersonation = async (targetId: string, membershipId: string, reason: string, ticket: string | null): Promise<StartResult> =>
  started(
    (
      await query(
        `mutation Start($targetId: ID!, $membershipId: ID!, $reason: String!, $ticket: String) {
          startImpersonation(targetId: $targetId, membershipId: $membershipId, reason: $reason, ticket: $ticket) { ok reason handoff session { ${sessionFields} } }
        }`,
        z.object({ startImpersonation: startSchema }),
        { targetId, membershipId, reason, ticket },
      )
    ).startImpersonation,
  )

// A setup session answers with its id; the record is read back so its facts are the API's.
export const startSetupSession = async (partner: Ref, reason: string, ticket: string | null): Promise<StartResult> => {
  const { startPartnerSetupSession: result } = await query(
    `mutation Setup($id: ID!, $reason: String!, $ticket: String) { startPartnerSetupSession(id: $id, reason: $reason, ticket: $ticket) { ok code handoff sessionId expiresAt } }`,
    z.object({ startPartnerSetupSession: z.object({ ok: z.boolean(), code: z.string().nullable(), handoff: z.string().nullable(), sessionId: z.string().nullable(), expiresAt: isoString.nullable() }) }),
    { id: partner.id, reason, ticket },
  )
  if (!result.ok || !result.handoff || !result.sessionId) return { ok: false, reason: refusalOf(result.code) }
  const lookup = await loadSession(result.sessionId)
  if (lookup.kind !== 'found') throw new ApiError('NOT_FOUND', 'The setup session the API started could not be read back.')
  return { ok: true, session: lookup.session, handoff: result.handoff }
}

export const returnToSession = async (id: string): Promise<StartResult> =>
  started((await query(`mutation Return($id: ID!) { returnToSession(id: $id) { ok reason handoff session { ${sessionFields} } } }`, z.object({ returnToSession: startSchema }), { id })).returnToSession)

export const endSession = async (id: string): Promise<SessionResult> => {
  const { endStaffSession: result } = await query(`mutation End($id: ID!) { endStaffSession(id: $id) { ok code } }`, z.object({ endStaffSession: z.object({ ok: z.boolean(), code: z.string().nullable() }) }), { id })
  return result.ok ? { ok: true } : { ok: false, reason: refusalOf(result.code) }
}

export const extendImpersonation = async (id: string): Promise<SessionResult> => {
  const { extendImpersonation: result } = await query(
    `mutation Extend($id: ID!) { extendImpersonation(id: $id) { ok reason expiresAt } }`,
    z.object({ extendImpersonation: z.object({ ok: z.boolean(), reason: z.string().nullable(), expiresAt: isoString.nullable() }) }),
    { id },
  )
  return result.ok ? { ok: true } : { ok: false, reason: refusalOf(result.reason) }
}
