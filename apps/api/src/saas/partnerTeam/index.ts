import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import { partnerRoles } from '#auth/partnerPermissions'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { insertPartnerUser, revokeInvitation } from '#db/scoped/partners'
import {
  countActiveOwners,
  endMemberSessions,
  insertTeamInvitation,
  lockTeam,
  markMemberRemoved,
  reinviteMember,
  selectCompany,
  selectPlanFees,
  selectTeam,
  selectTeamMember,
  selectTeamMemberByEmail,
  setSecondFactorRequired,
  updateMemberRole,
  type PartnerRoleKey,
  type TeamMemberRow,
} from '#db/scoped/partnerTeam'
import { partnerEntry, type PageInfo } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { decodePage, pageOf, type PageRequest } from '#saas/staff/index'

// Settings on the Platform API (ui/platform/FIRST-RELEASE.md §14.1, §14.2, §14.4; card #199): the
// company read, the team and its changes, and the Owner's 2-factor policy (ACCESS.md §2, §5.3, §6).

export const teamAudit = {
  inviteTeamMember: 'partner_user.invited',
  resendTeamInvite: 'partner_user.invitation_resent',
  revokeTeamInvite: 'partner_user.invitation_revoked',
  changeTeamRole: 'partner_user.role_changed',
  removeTeamMember: 'partner_user.removed',
  transferOwnership: 'partner.ownership_transferred',
  setSecondFactorPolicy: 'partner.second_factor_policy_set',
} as const

export const teamPageSize = 25
const invitationDays = 7
const owner: PartnerRoleKey = 'partner-owner'

export type TeamRefusal = 'LAST_OWNER' | 'OWNERS_ONLY' | 'CANNOT_REMOVE_SELF' | 'ALREADY_ON_TEAM' | 'NOT_FOUND' | 'INVALID_INPUT' | 'NO_PENDING_INVITATION' | 'NOT_ACTIVE'
export type TeamResult = { ok: true } | { ok: false; reason: TeamRefusal }

const inviteInput = z.strictObject({ name: z.string().trim().min(1).max(120), email: z.email().max(254), role: z.enum(partnerRoles) })
const id = z.guid()

export interface PartnerTeamDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

const memberDto = (m: TeamMemberRow, callerId: string, at: Date) => ({
  id: m.id,
  name: m.name,
  email: m.email,
  role: m.role_key,
  you: m.id === callerId,
  status: m.status,
  lastSignInAt: m.last_sign_in_at,
  invitation: m.invitation_id && m.status === 'invited' ? { sentAt: m.invitation_sent_at, expired: m.invitation_expires_at !== null && m.invitation_expires_at <= at } : null,
  secondFactor: m.two_factor_enrolled_at !== null,
})
export type TeamMemberDto = ReturnType<typeof memberDto>

export const createPartnerTeamService = ({ sql, caller, facts, activity, now }: PartnerTeamDeps) => {
  const partnerId = caller.partner.id
  const context = { caller: { kind: 'partner-user' as const, partnerUserId: caller.user.id }, partnerId }
  const entry = partnerEntry(caller, facts)
  // §14.2: Admins never touch an Owner, nor make one. Judged on the caller's role as read under
  // the team lock, so a change made meanwhile (a demotion, a transfer) is what counts.
  const mayTouch = (callerRole: PartnerRoleKey, role: PartnerRoleKey) => callerRole === owner || role !== owner
  const freshCaller = async (tx: ScopedSql): Promise<TeamMemberRow | null> => {
    const me = await selectTeamMember(tx, partnerId, caller.user.id)
    return me && me.status === 'active' ? me : null
  }

  const queueInvitation = (tx: ScopedSql, invitationId: string, to: string) =>
    queueSideEffect(tx, {
      kind: 'email',
      idempotencyKey: `partner-team-invitation:${invitationId}`,
      payload: { template: 'partner-team-invitation', partnerInvitationId: invitationId, to, partnerName: caller.partner.name },
      partnerId,
      storeId: null,
    })

  /** One change at a time to the partner's team, on the member read under that lock. */
  const change = (memberId: string, work: (tx: ScopedSql, member: TeamMemberRow, me: TeamMemberRow, at: Date) => Promise<TeamResult>): Promise<TeamResult> => {
    if (!id.safeParse(memberId).success) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return withScope(sql, context, async (tx) => {
      await lockTeam(tx, partnerId)
      const me = await freshCaller(tx)
      if (!me) return { ok: false, reason: 'NOT_ACTIVE' }
      const member = await selectTeamMember(tx, partnerId, memberId)
      if (!member || member.status === 'removed') return { ok: false, reason: 'NOT_FOUND' }
      if (!mayTouch(me.role_key, member.role_key)) return { ok: false, reason: 'OWNERS_ONLY' }
      return work(tx, member, me, now())
    })
  }

  const partnerCompany = () =>
    withScope(sql, context, async (tx) => {
      const company = await selectCompany(tx, partnerId)
      if (!company) return null
      const members = await selectTeam(tx, partnerId, {}, 100)
      const main = members.find((m) => m.role_key === owner && m.status === 'active') ?? null
      const finance = members.find((m) => m.role_key === 'partner-finance' && m.status === 'active') ?? null
      return {
        name: company.name,
        country: company.country,
        region: company.region,
        kind: company.kind,
        mainContact: main ? { name: main.name, email: main.email } : null,
        billingContact: finance ? { name: finance.name, email: finance.email } : null,
        contract: company.fee_currency
          ? { feeCurrency: company.fee_currency, poweredByRemovable: company.powered_by_removable ?? false, poweredByNote: company.powered_by_note, fees: await selectPlanFees(tx, partnerId) }
          : null,
        secondFactorRequired: company.second_factor_required,
      }
    })

  /** Null for a cursor it cannot read. */
  const team = (page: PageRequest): Promise<{ items: TeamMemberDto[]; pageInfo: PageInfo } | null> => {
    const decoded = decodePage(page, teamPageSize)
    if (!decoded.ok) return Promise.resolve(null)
    return withScope(sql, context, async (tx) => {
      const rows = await selectTeam(tx, partnerId, decoded, decoded.limit)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.created_at, id: r.id }))
      const at = now()
      return { items: pageRows.map((m) => memberDto(m, caller.user.id, at)), pageInfo }
    })
  }

  // ACCESS §6.2: accounts are per partner, so an address with an account under another partner
  // is invited exactly as a new one; only this team's own member is named (ALREADY_ON_TEAM).
  const inviteTeamMember = (raw: unknown): Promise<TeamResult> => {
    const parsed = inviteInput.safeParse(raw)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const { name, email, role } = parsed.data
    return withScope(sql, context, async (tx): Promise<TeamResult> => {
      await lockTeam(tx, partnerId)
      const me = await freshCaller(tx)
      if (!me) return { ok: false, reason: 'NOT_ACTIVE' }
      if (!mayTouch(me.role_key, role)) return { ok: false, reason: 'OWNERS_ONLY' }
      const at = now()
      const existing = await selectTeamMemberByEmail(tx, partnerId, email)
      if (existing && existing.status !== 'removed') return { ok: false, reason: 'ALREADY_ON_TEAM' }
      let userId: string
      if (existing) {
        await reinviteMember(tx, existing.id, name, role)
        userId = existing.id
      } else {
        // 0011's email limit (three partners per address) refuses a fourth account; the answer is the same.
        const created = await tx.savepoint((sp) => insertPartnerUser(sp, { partnerId, email, name, role, status: 'invited' })).catch((error: unknown) => {
          if (typeof error === 'object' && error !== null && 'code' in error && error.code === '23514') return null
          throw error
        })
        if (created === null) return { ok: true }
        userId = created
      }
      const invitationId = await insertTeamInvitation(tx, { partnerId, userId, sentAt: at, expiresAt: new Date(at.getTime() + invitationDays * 86_400_000), byLabel: caller.user.name })
      await queueInvitation(tx, invitationId, email)
      await activity.record(tx, entry({ action: teamAudit.inviteTeamMember, target: { type: 'partner_user', id: userId, label: email }, reason: null, changes: [{ field: 'role', before: null, after: role }] }))
      return { ok: true }
    })
  }

  // ACCESS §6.3: a resend mints a fresh invitation and the old link stops working.
  const resendTeamInvite = (memberId: string) =>
    change(memberId, async (tx, member, _me, at) => {
      if (member.status !== 'invited' || !member.invitation_id) return { ok: false, reason: 'NO_PENDING_INVITATION' }
      await revokeInvitation(tx, member.invitation_id, at)
      const invitationId = await insertTeamInvitation(tx, { partnerId, userId: member.id, sentAt: at, expiresAt: new Date(at.getTime() + invitationDays * 86_400_000), byLabel: caller.user.name })
      await queueInvitation(tx, invitationId, member.email)
      await activity.record(tx, entry({ action: teamAudit.resendTeamInvite, target: { type: 'partner_user', id: member.id, label: member.email }, reason: null }))
      return { ok: true }
    })

  const revokeTeamInvite = (memberId: string) =>
    change(memberId, async (tx, member, _me, at) => {
      if (member.status !== 'invited' || !member.invitation_id) return { ok: false, reason: 'NO_PENDING_INVITATION' }
      await revokeInvitation(tx, member.invitation_id, at)
      await markMemberRemoved(tx, member.id)
      await activity.record(tx, entry({ action: teamAudit.revokeTeamInvite, target: { type: 'partner_user', id: member.id, label: member.email }, reason: null }))
      return { ok: true }
    })

  const changeTeamRole = (memberId: string, rawRole: unknown) => {
    const role = z.enum(partnerRoles).safeParse(rawRole)
    if (!role.success) return Promise.resolve<TeamResult>({ ok: false, reason: 'INVALID_INPUT' })
    return change(memberId, async (tx, member, me) => {
      if (!mayTouch(me.role_key, role.data)) return { ok: false, reason: 'OWNERS_ONLY' }
      if (member.role_key === role.data) return { ok: true }
      // §14.2: "There must be at least one Owner. Transfer ownership first."
      if (member.role_key === owner && member.status === 'active' && (await countActiveOwners(tx, partnerId)) <= 1) return { ok: false, reason: 'LAST_OWNER' }
      await updateMemberRole(tx, member.id, role.data)
      await activity.record(tx, entry({ action: teamAudit.changeTeamRole, target: { type: 'partner_user', id: member.id, label: member.email }, reason: null, changes: [{ field: 'role', before: member.role_key, after: role.data }] }))
      return { ok: true }
    })
  }

  const removeTeamMember = (memberId: string) =>
    change(memberId, async (tx, member, me, at) => {
      // The row's own id, not the typed one: a uuid matches in any case.
      if (member.id === me.id) return { ok: false, reason: 'CANNOT_REMOVE_SELF' }
      if (member.role_key === owner && member.status === 'active' && (await countActiveOwners(tx, partnerId)) <= 1) return { ok: false, reason: 'LAST_OWNER' }
      if (member.invitation_id) await revokeInvitation(tx, member.invitation_id, at)
      await markMemberRemoved(tx, member.id)
      // "{name} is signed out now and can't sign in again."
      await endMemberSessions(tx, member.id)
      await activity.record(tx, entry({ action: teamAudit.removeTeamMember, target: { type: 'partner_user', id: member.id, label: member.email }, reason: null, changes: [{ field: 'status', before: member.status, after: 'removed' }] }))
      return { ok: true }
    })

  // §14.2: to an active non-Owner; the Owner becomes an Admin.
  const transferOwnership = (toUserId: string) =>
    change(toUserId, async (tx, member, me) => {
      if (me.role_key !== owner) return { ok: false, reason: 'OWNERS_ONLY' }
      if (member.id === me.id) return { ok: false, reason: 'INVALID_INPUT' }
      if (member.status !== 'active') return { ok: false, reason: 'NOT_ACTIVE' }
      if (member.role_key === owner) return { ok: false, reason: 'INVALID_INPUT' }
      await updateMemberRole(tx, member.id, owner)
      await updateMemberRole(tx, me.id, 'partner-admin')
      await activity.record(
        tx,
        entry({
          action: teamAudit.transferOwnership,
          target: { type: 'partner_user', id: member.id, label: member.email },
          reason: null,
          changes: [
            { field: 'owner', before: caller.user.email, after: member.email },
            { field: 'previous_owner_role', before: owner, after: 'partner-admin' },
          ],
        }),
      )
      return { ok: true }
    })

  // §14.4: a user without 2-factor enrols at their next sign-in; turning it off removes nobody's.
  const setSecondFactorPolicy = (required: unknown): Promise<TeamResult> => {
    const parsed = z.boolean().safeParse(required)
    if (!parsed.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    return withScope(sql, context, async (tx) => {
      const before = (await selectCompany(tx, partnerId))?.second_factor_required ?? false
      if (before === parsed.data) return { ok: true }
      await setSecondFactorRequired(tx, partnerId, parsed.data)
      await activity.record(tx, entry({ action: teamAudit.setSecondFactorPolicy, target: { type: 'partner', id: partnerId, label: caller.partner.name }, reason: null, changes: [{ field: 'second_factor_required', before, after: parsed.data }] }))
      return { ok: true }
    })
  }

  return { partnerCompany, team, inviteTeamMember, resendTeamInvite, revokeTeamInvite, changeTeamRole, removeTeamMember, transferOwnership, setSecondFactorPolicy }
}

export type PartnerTeamService = ReturnType<typeof createPartnerTeamService>
