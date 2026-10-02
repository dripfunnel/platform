import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { AccessTarget } from '#auth/assignment'
import { partnerScopedRoles, roleHas, type StaffPermission } from '#auth/permissions'
import { hashSessionId, newSessionId } from '#auth/session'
import type { StaffMember } from '#auth/staff'
import { decodeCursor, encodeCursor } from '#core/cursor'
import { parseHostname } from '#core/hostname'
import type { StaffContext } from '#core/tenancy'
import type { DomainKind, HostStatus, PartnerDomainRow, PartnerRow, PartnerSetupItemRow, PartnerState, PlanRow } from '#db/schema/saas'
import { domainKinds } from '#db/schema/saas'
import { selectActivity } from '#db/scoped/activity'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  endSetupSession,
  expireStaleSetupSessions,
  insertPartner,
  insertPartnerApproval,
  insertPartnerInvitation,
  insertPartnerUser,
  insertSetupSession,
  markInvitationSent,
  revokeInvitation,
  selectCurrentApproversFor,
  selectOpenInvitation,
  selectOpenSetupSessionOf,
  selectPartner,
  selectPartnerDomain,
  selectPartnerDomainsFor,
  selectPartnerForUpdate,
  selectPartnerListRow,
  selectPartnerOwner,
  selectPartners,
  selectPartnerUsers,
  selectPlansFor,
  selectSetupItemsFor,
  selectSetupSession,
  selectSetupSessionsFor,
  upsertSetupItem,
  type PartnerListRow,
  type SetupSessionRow,
} from '#db/scoped/partners'
import type { PageInfo } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { transitionPartner } from './states'
import { approvalRuleFor, approvalVerdict, type ApprovalRule } from './approval'
import { failingChecks, goLiveChecksFor, type GoLiveCheck, type GoLiveChecks } from './goLive'

// Partners on the Admin API (card #33; ui/admin/FIRST-RELEASE.md §4, §12). The resolvers in
// apis/admin/partners.ts are thin; everything a screen is told comes from here, and every
// write records its entry in the same transaction (LOGGING.md §5).

export const partnerPageSize = 25
export const setupSessionMs = 2 * 60 * 60 * 1000
export const handoffMs = 5 * 60 * 1000
export const invitationDays = 7

/** The action each mutation records; apis/admin/partners.ts declares the same codes (LOGGING.md §5). */
export const partnerAudit = {
  createPartner: 'partner.created',
  approvePartner: 'partner.approved',
  approvalRecorded: 'partner.approval_recorded',
  sendBackPartner: 'partner.sent_back',
  pausePartner: 'partner.paused',
  resumePartner: 'partner.resumed',
  sendPartnerOwnerInvite: 'partner.invitation_sent',
  resendPartnerOwnerInvite: 'partner.invitation_resent',
  startPartnerSetupSession: 'setup_session.started',
  endStaffSession: 'setup_session.ended',
  recheckDomain: 'partner.domain_recheck_requested',
} as const

export type PartnerAuditAction = (typeof partnerAudit)[keyof typeof partnerAudit]

export type PartnerActionName = 'approve' | 'sendBack' | 'pause' | 'resume' | 'setupSession' | 'sendInvite' | 'resendInvite'

export type RefusalCode =
  | 'SUPER_ADMIN_ONLY'
  | 'PARTNER_ADMINS_ONLY'
  | 'INVITERS_ONLY'
  | 'NOT_ASSIGNED'
  | 'HOUSE_PARTNER'
  | 'GO_LIVE_CHECKS_FAILING'
  | 'SET_UP_BY_CALLER'
  | 'ALREADY_APPROVED_BY_CALLER'
  | 'INVALID_STATE'
  | 'REASON_REQUIRED'
  | 'INVALID_INPUT'
  | 'INVALID_HOSTNAME'
  | 'NOT_FOUND'
  | 'INVITATION_HELD'
  | 'INVITATION_NOT_HELD'
  | 'INVITATION_ACCEPTED'
  | 'STAFF_ROLE_NOT_ALLOWED'
  | 'PARTNER_CLOSED'
  | 'SETUP_SESSION_ALREADY_OPEN'
  | 'REAUTH_REQUIRED'
  | 'NOT_SESSION_OWNER'
  | 'SESSION_ENDED'

export type ActionPermission = { allowed: true } | { allowed: false; reason: RefusalCode; failingChecks?: GoLiveCheck[] }

export type PartnerPermissions = Partial<Record<PartnerActionName, ActionPermission>>

export interface PartnerRowDto {
  id: string
  name: string
  house: boolean
  kind: string | null
  region: string | null
  state: PartnerState
  stores: number
  portalHost: { host: string | null; status: HostStatus | null }
  setup: { done: number; total: number }
  owner: { name: string | null; email: string | null; invitation: 'active' | 'sent' | 'held' | null; invitationSentAt: Date | null }
  createdAt: Date
  submittedAt: Date | null
  checks: GoLiveChecks
  approval: { setUpBy: string | null; rule: ApprovalRule['rule']; approvals: number } | null
}

export interface SetupSessionDto {
  id: string
  staff: string
  reason: string
  ticket: string | null
  startedAt: Date
  expiresAt: Date
  endedAt: Date | null
  status: 'open' | 'ended' | 'expired'
  /** ACCESS.md §8.3: what the caller may do to it, never worked out by the console. */
  end: ActionPermission
}

export interface PartnerDto extends PartnerRowDto {
  country: string | null
  contacts: { name: string; role: string; email: string }[]
  history: { at: Date; action: string; by: string | null; note: string | null }[]
  checklist: { item: PartnerSetupItemRow['item']; status: PartnerSetupItemRow['status']; detail: string | null; by: { name: string; org: string } | null }[]
  branding: { productName: string | null; primaryColor: string | null; accentColor: string | null; poweredBy: PartnerRow['powered_by'] }
  domains: { id: string; kind: DomainKind; host: string; status: HostStatus; record: string; expected: string; found: string | null; checkedAt: Date | null }[]
  plans: { id: string; name: string; status: PlanRow['status']; maxProducts: number | null; maxStaff: number | null; stores: number }[]
  team: { id: string; name: string; email: string; role: string; status: string; lastSignInAt: Date | null }[]
  setupSessions: SetupSessionDto[]
  actions: PartnerPermissions
}

export interface PartnerPage {
  items: PartnerRowDto[]
  pageInfo: PageInfo
  create: ActionPermission
}

export const partnerFilter = z
  .object({
    state: z.enum(['draft', 'awaiting', 'live', 'paused', 'offboarding', 'closed']).optional(),
    setup: z.enum(['complete', 'incomplete']).optional(),
    q: z.string().trim().min(1).max(100).optional(),
    sort: z.enum(['newest', 'oldestSubmitted']).optional(),
  })
  .strict()

export type PartnerFilter = z.infer<typeof partnerFilter>

export interface PageRequest {
  after?: string | null | undefined
  before?: string | null | undefined
  first?: number | null | undefined
}

export const createPartnerInput = z
  .object({
    name: z.string().trim().min(1).max(120),
    ownerEmail: z.email().max(254),
    ownerName: z.string().trim().min(1).max(120).optional(),
    country: z.string().regex(/^[A-Z]{2}$/),
    kind: z.string().trim().min(1).max(60).optional(),
    region: z.string().trim().min(1).max(120).optional(),
    sendInvitation: z.boolean(),
  })
  .strict()

export type CreatePartnerInput = z.infer<typeof createPartnerInput>

export type Refusal = { ok: false; code: RefusalCode; failingChecks?: GoLiveCheck[] }

export type Result<T = object> = ({ ok: true } & T) | Refusal

export interface PartnersServiceDeps {
  sql: postgres.Sql
  staff: StaffMember
  reauthFresh: boolean
  facts: RequestFacts
  activity: ActivityLog
  isAssigned: (staffId: string, target: AccessTarget) => Promise<boolean>
  now: () => Date
}

const reasonText = z.string().trim().min(1).max(500)

/** The code a role refusal carries, per permission, so the block and the policy agree (ACCESS.md §5.4). */
const roleRefusals: Partial<Record<StaffPermission, RefusalCode>> = {
  'partners.create': 'PARTNER_ADMINS_ONLY',
  'partners.approve': 'PARTNER_ADMINS_ONLY',
  'partners.pause': 'SUPER_ADMIN_ONLY',
  'partners.invite': 'PARTNER_ADMINS_ONLY',
  'partners.invite.resend': 'INVITERS_ONLY',
  'partners.setup': 'STAFF_ROLE_NOT_ALLOWED',
  'domains.recheck': 'STAFF_ROLE_NOT_ALLOWED',
}

interface PartnerFacts {
  domains: PartnerDomainRow[]
  items: PartnerSetupItemRow[]
  plans: (PlanRow & { store_count: number })[]
  sessions: SetupSessionRow[]
  approvers: string[]
  checks: GoLiveChecks
  rule: ApprovalRule
}

export const createPartnersService = (deps: PartnersServiceDeps) => {
  const { sql, staff, facts, activity, now } = deps
  const context: StaffContext = { caller: { kind: 'staff', staffId: staff.id } }
  const label = `${staff.name} <${staff.email}>`
  const scopedByAssignment = partnerScopedRoles.includes(staff.role)

  const entry = (partner: Pick<PartnerRow, 'id' | 'name'>, action: PartnerAuditAction, reason: string | null, extra: Partial<ActivityEntry> = {}): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'staff',
    actorId: staff.id,
    actorLabel: label,
    partnerId: partner.id,
    target: { type: 'partner', id: partner.id, label: partner.name },
    reason,
    api: 'admin',
    visibility: 'partner',
    ...facts,
    ...extra,
  })

  const may = (permission: StaffPermission): ActionPermission =>
    roleHas(staff.role, permission) ? { allowed: true } : { allowed: false, reason: roleRefusals[permission] ?? 'STAFF_ROLE_NOT_ALLOWED' }

  const refusedBy = (permission: StaffPermission): Refusal | null => {
    const p = may(permission)
    return p.allowed ? null : { ok: false, code: p.reason }
  }

  const assigned = async (partnerId: string): Promise<boolean> => !scopedByAssignment || deps.isAssigned(staff.id, { partnerId })

  // The block FIRST-RELEASE §4.3 draws: an action absent is not offered in this state; one
  // present but refused is disabled with its reason. Record rules win over role rules, so the
  // reason names what would actually unblock it (decided on #19 and #31).
  const permissionsFor = async (partner: PartnerRow, f: PartnerFacts, ownerInvitation: PartnerRowDto['owner']['invitation']): Promise<PartnerPermissions> => {
    const actions: PartnerPermissions = {}
    if (partner.state === 'closed') return actions
    const notAssigned: ActionPermission | null = (await assigned(partner.id)) ? null : { allowed: false, reason: 'NOT_ASSIGNED' }
    if (roleHas(staff.role, 'partners.setup')) actions.setupSession = notAssigned ?? { allowed: true }
    if (partner.state === 'awaiting') {
      const failing = failingChecks(f.checks)
      const verdict = approvalVerdict(f.rule, { id: staff.id, role: staff.role }, f.approvers)
      actions.approve =
        failing.length > 0
          ? { allowed: false, reason: 'GO_LIVE_CHECKS_FAILING', failingChecks: failing }
          : verdict === 'SET_UP_BY_CALLER' || verdict === 'ALREADY_APPROVED_BY_CALLER'
            ? { allowed: false, reason: verdict }
            : (notAssigned ?? may('partners.approve'))
      actions.sendBack = notAssigned ?? may('partners.approve')
    }
    if (partner.state === 'live') actions.pause = partner.is_house ? { allowed: false, reason: 'HOUSE_PARTNER' } : may('partners.pause')
    if (partner.state === 'paused') actions.resume = may('partners.pause')
    if (ownerInvitation === 'held') actions.sendInvite = notAssigned ?? may('partners.invite')
    if (ownerInvitation === 'sent') actions.resendInvite = notAssigned ?? may('partners.invite.resend')
    return actions
  }

  // One query per table for the whole page (AGENTS.md "Reliability": no N+1).
  const factsFor = async (tx: ScopedSql, partners: readonly PartnerRow[]): Promise<Map<string, PartnerFacts>> => {
    const ids = partners.map((p) => p.id)
    const [domains, items, plans, sessions, approvers] = await Promise.all([
      selectPartnerDomainsFor(tx, ids),
      selectSetupItemsFor(tx, ids),
      selectPlansFor(tx, ids),
      selectSetupSessionsFor(tx, ids),
      selectCurrentApproversFor(tx, ids),
    ])
    const byPartner = <T extends { partner_id: string }>(rows: T[]) => {
      const map = new Map<string, T[]>()
      for (const row of rows) map.set(row.partner_id, [...(map.get(row.partner_id) ?? []), row])
      return map
    }
    const d = byPartner(domains)
    const i = byPartner(items)
    const pl = byPartner(plans)
    const s = byPartner(sessions)
    const a = byPartner(approvers)
    return new Map(
      partners.map((p) => {
        const f = { domains: d.get(p.id) ?? [], items: i.get(p.id) ?? [], plans: pl.get(p.id) ?? [], sessions: s.get(p.id) ?? [] }
        return [
          p.id,
          {
            ...f,
            approvers: (a.get(p.id) ?? []).map((row) => row.staff_user_id),
            checks: goLiveChecksFor(f.domains, f.items, f.plans, p.fallback_sender_accepted),
            rule: approvalRuleFor(f.sessions, p.submitted_at),
          },
        ]
      }),
    )
  }

  const rowOf = (row: PartnerListRow, f: PartnerFacts): PartnerRowDto => ({
    id: row.id,
    name: row.name,
    house: row.is_house,
    kind: row.kind,
    region: row.region,
    state: row.state,
    stores: row.store_count,
    portalHost: { host: row.portal_host, status: row.portal_status },
    setup: { done: row.setup_done, total: row.setup_total },
    owner: { name: row.owner_name, email: row.owner_email, invitation: row.owner_invitation, invitationSentAt: row.owner_invitation_sent_at },
    createdAt: row.created_at,
    submittedAt: row.state === 'awaiting' ? row.submitted_at : null,
    checks: f.checks,
    approval: row.state === 'awaiting' ? { setUpBy: f.rule.setUpBy?.name ?? null, rule: f.rule.rule, approvals: f.approvers.length } : null,
  })

  const list = async (filter: unknown, page: PageRequest): Promise<Result<{ page: PartnerPage }>> => {
    const parsed = partnerFilter.safeParse(filter ?? {})
    if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' }
    const after = page.after ? decodeCursor(page.after) : undefined
    const before = page.before ? decodeCursor(page.before) : undefined
    if (after === null || before === null) return { ok: false, code: 'INVALID_INPUT' }
    const limit = Math.min(Math.max(page.first ?? partnerPageSize, 1), partnerPageSize)
    const sort = parsed.data.sort ?? 'newest'
    return withScope(sql, context, async (tx) => {
      // ACCESS.md §5.4: a list filters to a Partner manager's assignment itself.
      const rows = await selectPartners(tx, { ...parsed.data, assignedTo: scopedByAssignment ? staff.id : undefined }, { after, before }, limit, sort)
      const more = rows.length > limit
      const pageRows = before ? rows.slice(more ? 1 : 0) : rows.slice(0, limit)
      const factsMap = await factsFor(tx, pageRows)
      const items = pageRows.map((row) => {
        const f = factsMap.get(row.id)
        if (!f) throw new Error('facts missing for a listed partner')
        return rowOf(row, f)
      })
      const keyOf = (row: PartnerListRow) => encodeCursor({ occurredAt: sort === 'newest' ? row.created_at : (row.submitted_at ?? row.created_at), id: row.id })
      const first = pageRows[0]
      const last = pageRows.at(-1)
      return {
        ok: true,
        page: {
          items,
          pageInfo: {
            startCursor: first ? keyOf(first) : null,
            endCursor: last ? keyOf(last) : null,
            hasPreviousPage: before ? more : after !== undefined,
            hasNextPage: before ? true : more,
          },
          create: may('partners.create'),
        },
      }
    })
  }

  const sessionDto = (s: SetupSessionRow, at: Date): SetupSessionDto => {
    const status = s.ended_at ? 'ended' : s.expires_at <= at ? 'expired' : 'open'
    const end: ActionPermission =
      status !== 'open'
        ? { allowed: false, reason: 'SESSION_ENDED' }
        : s.staff_user_id === staff.id || staff.role === 'staff-super-admin'
          ? { allowed: true }
          : { allowed: false, reason: 'NOT_SESSION_OWNER' }
    return {
      id: s.id,
      staff: s.staff_name,
      reason: s.reason,
      ticket: s.ticket,
      startedAt: s.started_at,
      expiresAt: s.expires_at,
      endedAt: s.ended_at ?? (status === 'expired' ? s.expires_at : null),
      status,
      end,
    }
  }

  const get = async (id: string): Promise<PartnerDto | null> =>
    withScope(sql, context, async (tx) => {
      const partner = await selectPartner(tx, id)
      if (!partner) return null
      const listRow = await selectPartnerListRow(tx, id)
      const f = (await factsFor(tx, [partner])).get(id)
      if (!listRow || !f) return null
      const team = await selectPartnerUsers(tx, id)
      const history = await selectActivity(tx, { targetType: 'partner', targetId: id }, {}, 100)
      const base = rowOf(listRow, f)
      const at = now()
      return {
        ...base,
        country: partner.country,
        contacts: team.map((u) => ({ name: u.name, role: u.role_key, email: u.email })),
        history: history.reverse().map((h) => ({ at: h.occurred_at, action: h.action, by: h.actor_label, note: h.reason })),
        checklist: f.items.map((i) => ({
          item: i.item,
          status: i.status,
          detail: i.detail,
          by: i.done_by_label ? { name: i.done_by_label, org: i.done_by_kind === 'staff' ? 'DripFunnel' : partner.name } : null,
        })),
        branding: { productName: partner.product_name, primaryColor: partner.primary_color, accentColor: partner.accent_color, poweredBy: partner.powered_by },
        domains: f.domains.map((d) => ({ id: d.id, kind: d.kind, host: d.host, status: d.status, record: d.record_type, expected: d.expected, found: d.found, checkedAt: d.checked_at })),
        plans: f.plans.map((p) => ({ id: p.id, name: p.name, status: p.status, maxProducts: p.max_products, maxStaff: p.max_staff, stores: p.store_count })),
        team: team.map((u) => ({ id: u.id, name: u.name, email: u.email, role: u.role_key, status: u.status, lastSignInAt: u.last_sign_in_at })),
        setupSessions: f.sessions.map((s) => sessionDto(s, at)),
        actions: await permissionsFor(partner, f, base.owner.invitation),
      }
    })

  const stateChange = async (
    id: string,
    reason: string | null,
    action: PartnerAuditAction,
    change: (partner: PartnerRow) => Parameters<typeof transitionPartner>[2] | Refusal,
  ): Promise<Result<{ state: PartnerState }>> => {
    const parsedReason = reasonText.safeParse(reason ?? '')
    if (!parsedReason.success) return { ok: false, code: 'REASON_REQUIRED' }
    return withScope(sql, context, async (tx): Promise<Result<{ state: PartnerState }>> => {
      const partner = await selectPartnerForUpdate(tx, id)
      if (!partner) return { ok: false, code: 'NOT_FOUND' }
      const next = change(partner)
      if ('ok' in next) return next
      const result = await transitionPartner(tx, partner, next, now())
      if (!result.ok) return { ok: false, code: result.code === 'HOUSE_PARTNER' ? 'HOUSE_PARTNER' : result.code === 'REASON_REQUIRED' ? 'REASON_REQUIRED' : 'INVALID_STATE' }
      await activity.record(tx, entry(partner, action, parsedReason.data))
      return { ok: true, state: next.to }
    })
  }

  const approvePartner = async (id: string, reason: string | null): Promise<Result<{ state: PartnerState; approvals: number }>> => {
    const refused = refusedBy('partners.approve')
    if (refused) return refused
    const parsed = reasonText.safeParse(reason ?? '')
    if (!parsed.success) return { ok: false, code: 'REASON_REQUIRED' }
    return withScope(sql, context, async (tx): Promise<Result<{ state: PartnerState; approvals: number }>> => {
      const partner = await selectPartnerForUpdate(tx, id)
      if (!partner) return { ok: false, code: 'NOT_FOUND' }
      if (partner.state !== 'awaiting' || !partner.submitted_at) return { ok: false, code: 'INVALID_STATE' }
      const f = (await factsFor(tx, [partner])).get(id)
      if (!f) return { ok: false, code: 'NOT_FOUND' }
      const failing = failingChecks(f.checks)
      if (failing.length > 0) return { ok: false, code: 'GO_LIVE_CHECKS_FAILING', failingChecks: failing }
      const verdict = approvalVerdict(f.rule, { id: staff.id, role: staff.role }, f.approvers)
      if (verdict === 'SET_UP_BY_CALLER' || verdict === 'ALREADY_APPROVED_BY_CALLER') return { ok: false, code: verdict }
      // The note on contract and KYC is a staff record: it lives on the approval row and in a
      // staff-only entry, never in the partner's log (FIRST-RELEASE §4.3 marks only the
      // send-back reason as shown to the partner).
      await insertPartnerApproval(tx, { partnerId: id, staffUserId: staff.id, submittedAt: partner.submitted_at, note: parsed.data, approvedAt: now() })
      await activity.record(tx, entry(partner, partnerAudit.approvalRecorded, parsed.data, { visibility: 'staff' }))
      if (verdict === 'needs_second') return { ok: true, state: 'awaiting', approvals: f.approvers.length + 1 }
      const result = await transitionPartner(tx, partner, { to: 'live' }, now())
      if (!result.ok) return { ok: false, code: 'INVALID_STATE' }
      await activity.record(tx, entry(partner, partnerAudit.approvePartner, null))
      // SAAS.md §3.1: approval opens merchant sign-up on the portal host.
      await queueSideEffect(tx, { kind: 'cache.purge', idempotencyKey: `partner-live:${id}:${partner.submitted_at.toISOString()}`, payload: { partnerId: id, reason: 'approved' }, partnerId: id, storeId: null })
      return { ok: true, state: 'live', approvals: f.approvers.length + 1 }
    })
  }

  const sendBackPartner = async (id: string, reason: string | null): Promise<Result<{ state: PartnerState }>> =>
    refusedBy('partners.approve') ?? stateChange(id, reason, partnerAudit.sendBackPartner, () => ({ to: 'draft', reason: reason?.trim() ?? '' }))

  const pausePartner = async (id: string, reason: string | null): Promise<Result<{ state: PartnerState }>> =>
    refusedBy('partners.pause') ??
    stateChange(id, reason, partnerAudit.pausePartner, (partner) => (partner.is_house ? { ok: false, code: 'HOUSE_PARTNER' } : { to: 'paused', reason: reason?.trim() ?? '' }))

  const resumePartner = async (id: string, reason: string | null): Promise<Result<{ state: PartnerState }>> =>
    refusedBy('partners.pause') ?? stateChange(id, reason, partnerAudit.resumePartner, (partner) => (partner.state === 'paused' ? { to: 'live' } : { ok: false, code: 'INVALID_STATE' }))

  const queueInvitationEmail = async (tx: ScopedSql, partner: Pick<PartnerRow, 'id' | 'name'>, invitationId: string, ownerEmail: string) => {
    // The deliverer mints the token when it sends, so no secret rests in the outbox (ACCESS §6.1).
    await queueSideEffect(tx, {
      kind: 'email',
      idempotencyKey: `partner-owner-invitation:${invitationId}`,
      payload: { template: 'partner-owner-invitation', partnerInvitationId: invitationId, to: ownerEmail, partnerName: partner.name },
      partnerId: partner.id,
      storeId: null,
    })
  }

  const createPartner = async (input: unknown): Promise<Result<{ id: string }>> => {
    const refused = refusedBy('partners.create')
    if (refused) return refused
    const parsed = createPartnerInput.safeParse(input)
    if (!parsed.success) return { ok: false, code: 'INVALID_INPUT' }
    const data = parsed.data
    return withScope(sql, context, async (tx): Promise<Result<{ id: string }>> => {
      const at = now()
      const id = await insertPartner(tx, { name: data.name, country: data.country, kind: data.kind ?? null, region: data.region ?? null, createdAt: at })
      const ownerId = await insertPartnerUser(tx, { partnerId: id, email: data.ownerEmail, name: data.ownerName ?? data.ownerEmail, role: 'partner-owner', status: 'invited' })
      const invitationId = await insertPartnerInvitation(tx, {
        partnerId: id,
        partnerUserId: ownerId,
        sentAt: data.sendInvitation ? at : null,
        expiresAt: data.sendInvitation ? new Date(at.getTime() + invitationDays * 24 * 60 * 60 * 1000) : null,
        invitedByKind: 'staff',
        invitedByLabel: staff.name,
      })
      await upsertSetupItem(tx, { partnerId: id, item: 'company', status: 'done', detail: `${data.name}, ${data.country}`, doneByKind: 'staff', doneByLabel: 'DripFunnel', doneAt: at })
      const partner = { id, name: data.name }
      await activity.record(tx, entry(partner, partnerAudit.createPartner, null, { changes: [{ field: 'country', before: null, after: data.country }] }))
      if (data.sendInvitation) {
        await queueInvitationEmail(tx, partner, invitationId, data.ownerEmail)
        await activity.record(tx, entry(partner, partnerAudit.sendPartnerOwnerInvite, null, { target: { type: 'partner_user', id: ownerId, label: data.ownerEmail } }))
      }
      return { ok: true, id }
    })
  }

  const invite = async (id: string, resend: boolean): Promise<Result> => {
    const refused = refusedBy(resend ? 'partners.invite.resend' : 'partners.invite')
    if (refused) return refused
    return withScope(sql, context, async (tx): Promise<Result> => {
      const partner = await selectPartnerForUpdate(tx, id)
      if (!partner) return { ok: false, code: 'NOT_FOUND' }
      if (partner.state === 'closed') return { ok: false, code: 'PARTNER_CLOSED' }
      const owner = await selectPartnerOwner(tx, id)
      if (!owner) return { ok: false, code: 'NOT_FOUND' }
      if (owner.status === 'active') return { ok: false, code: 'INVITATION_ACCEPTED' }
      const open = await selectOpenInvitation(tx, owner.id)
      const at = now()
      const expires = new Date(at.getTime() + invitationDays * 24 * 60 * 60 * 1000)
      let invitationId: string
      if (resend) {
        if (!open) return { ok: false, code: 'INVITATION_NOT_HELD' }
        if (open.sent_at === null) return { ok: false, code: 'INVITATION_HELD' }
        // ACCESS.md §6.3: a resend mints a fresh invitation and the old link stops working.
        await revokeInvitation(tx, open.id, at)
        invitationId = await insertPartnerInvitation(tx, { partnerId: id, partnerUserId: owner.id, sentAt: at, expiresAt: expires, invitedByKind: 'staff', invitedByLabel: staff.name })
      } else {
        if (!open || open.sent_at !== null) return { ok: false, code: 'INVITATION_NOT_HELD' }
        await markInvitationSent(tx, open.id, at, expires)
        invitationId = open.id
      }
      await queueInvitationEmail(tx, partner, invitationId, owner.email)
      await activity.record(tx, entry(partner, resend ? partnerAudit.resendPartnerOwnerInvite : partnerAudit.sendPartnerOwnerInvite, null, { target: { type: 'partner_user', id: owner.id, label: owner.email } }))
      return { ok: true }
    })
  }

  const startSetupSession = async (id: string, reason: string | null, ticket: string | null): Promise<Result<{ sessionId: string; expiresAt: Date; handoff: string }>> => {
    const refused = refusedBy('partners.setup')
    if (refused) return refused
    const parsed = reasonText.safeParse(reason ?? '')
    if (!parsed.success) return { ok: false, code: 'REASON_REQUIRED' }
    if (!deps.reauthFresh) return { ok: false, code: 'REAUTH_REQUIRED' }
    return withScope(sql, context, async (tx): Promise<Result<{ sessionId: string; expiresAt: Date; handoff: string }>> => {
      const partner = await selectPartner(tx, id)
      if (!partner) return { ok: false, code: 'NOT_FOUND' }
      if (partner.state === 'closed') return { ok: false, code: 'PARTNER_CLOSED' }
      const at = now()
      await expireStaleSetupSessions(tx, staff.id, at)
      if (await selectOpenSetupSessionOf(tx, staff.id, at)) return { ok: false, code: 'SETUP_SESSION_ALREADY_OPEN' }
      const token = newSessionId()
      const expiresAt = new Date(at.getTime() + setupSessionMs)
      const sessionId = await insertSetupSession(tx, {
        staffUserId: staff.id,
        partnerId: id,
        reason: parsed.data,
        ticket: ticket?.trim() || null,
        startedAt: at,
        expiresAt,
        handoffHash: await hashSessionId(token),
        handoffExpiresAt: new Date(at.getTime() + handoffMs),
      })
      // Two starts at once: the partial unique index decides, and the loser gets the same code.
      if (!sessionId) return { ok: false, code: 'SETUP_SESSION_ALREADY_OPEN' }
      await activity.record(tx, entry(partner, partnerAudit.startPartnerSetupSession, parsed.data, { access: { kind: 'setup_session', id: sessionId } }))
      return { ok: true, sessionId, expiresAt, handoff: token }
    })
  }

  const endStaffSession = async (sessionId: string): Promise<Result> =>
    withScope(sql, context, async (tx): Promise<Result> => {
      const session = await selectSetupSession(tx, sessionId)
      if (!session) return { ok: false, code: 'NOT_FOUND' }
      const at = now()
      const permission = sessionDto(session, at).end
      if (!permission.allowed) return { ok: false, code: permission.reason }
      const partner = await selectPartner(tx, session.partner_id)
      if (!partner) return { ok: false, code: 'NOT_FOUND' }
      await endSetupSession(tx, sessionId, staff.id, at)
      await activity.record(tx, entry(partner, partnerAudit.endStaffSession, null, { access: { kind: 'setup_session', id: sessionId } }))
      return { ok: true }
    })

  const recheckDomain = async (id: string, kind: string): Promise<Result<{ status: 'queued' }>> => {
    const refused = refusedBy('domains.recheck')
    if (refused) return refused
    if (!(domainKinds as readonly string[]).includes(kind)) return { ok: false, code: 'INVALID_INPUT' }
    return withScope(sql, context, async (tx): Promise<Result<{ status: 'queued' }>> => {
      const partner = await selectPartner(tx, id)
      if (!partner) return { ok: false, code: 'NOT_FOUND' }
      const domain = await selectPartnerDomain(tx, id, kind as DomainKind)
      if (!domain) return { ok: false, code: 'NOT_FOUND' }
      // The stored host is checked again before it goes anywhere near a lookup.
      if (!parseHostname(domain.host).ok) return { ok: false, code: 'INVALID_HOSTNAME' }
      const at = now()
      // Once a minute at most per domain: the key folds requests within the same minute.
      await queueSideEffect(tx, {
        kind: 'domain.recheck',
        idempotencyKey: `${domain.id}:${Math.floor(at.getTime() / 60_000)}`,
        payload: { partnerId: id, domainId: domain.id },
        partnerId: id,
        storeId: null,
      })
      await activity.record(tx, entry(partner, partnerAudit.recheckDomain, null, { target: { type: 'domain', id: domain.id, label: domain.host } }))
      return { ok: true, status: 'queued' }
    })
  }

  return {
    list,
    get,
    createPartner,
    approvePartner,
    sendBackPartner,
    pausePartner,
    resumePartner,
    sendPartnerOwnerInvite: (id: string) => invite(id, false),
    resendPartnerOwnerInvite: (id: string) => invite(id, true),
    startSetupSession,
    endStaffSession,
    recheckDomain,
  }
}

export type PartnersService = ReturnType<typeof createPartnersService>
