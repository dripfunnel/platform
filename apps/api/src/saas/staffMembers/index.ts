import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { roleHas } from '#auth/permissions'
import { staffRoles, type StaffMember, type StaffRole } from '#auth/staff'
import { withScope, type ScopedSql } from '#db/scoped/index'
import {
  countActiveSuperAdmins,
  countRecentStaffInvites,
  insertInvitedStaff,
  insertStaffInvitation,
  lockStaffTeam,
  markStaffRemoved,
  revokeStaffInvitations,
  selectStaffByEmail,
  selectStaffMember,
  selectStaffPage,
  updateStaffRole,
  type StaffMemberRow,
} from '#db/scoped/staffMembers'
import type { PageInfo } from '#saas/activity/index'
import { queueSideEffect } from '#saas/outbox/index'
import { decodePage, pageOf, staffEntry, type PageRequest } from '#saas/staff/index'

// Staff on the Admin API (ui/admin/FIRST-RELEASE.md §10; card #39): the list, invitations by
// company email bound to the invitee's SSO on first sign-in, role changes and removal, with
// the last accepted Super admin kept under a lock (decided on #45).

export const staffPageSize = 25
export const invitationDays = 7
const superAdmin: StaffRole = 'staff-super-admin'
// ACCESS §13 item 13: an invitation can't be an email-bombing tool, per inviter or per address.
export const staffInviteLimits = { perInviterPerHour: 20, perAddressPerDay: 3 } as const

export const staffAudit = {
  inviteStaff: 'staff.invited',
  changeStaffRole: 'staff.role_changed',
  removeStaff: 'staff.removed',
  resendStaffInvite: 'staff.invitation_resent',
  revokeStaffInvite: 'staff.invitation_revoked',
} as const

export type StaffRefusal = 'SUPER_ADMIN_ONLY' | 'LAST_SUPER_ADMIN' | 'ALREADY_STAFF' | 'SAME_ROLE' | 'NOT_PENDING' | 'PENDING_INVITATION' | 'NOT_FOUND' | 'INVALID_INPUT' | 'RATE_LIMITED'
export type StaffResult = { ok: true } | { ok: false; reason: StaffRefusal }
type Permission = { allowed: true } | { allowed: false; reason: StaffRefusal }

const allowed: Permission = { allowed: true }
const refused = (reason: StaffRefusal): Permission => ({ allowed: false, reason })
const id = z.guid()
const role = z.enum(staffRoles)

export interface StaffMembersDeps {
  sql: postgres.Sql
  staff: StaffMember
  facts: RequestFacts
  activity: ActivityLog
  now: () => Date
}

export const createStaffMembersService = ({ sql, staff, facts, activity, now }: StaffMembersDeps) => {
  const context = { caller: { kind: 'staff' as const, staffId: staff.id } }
  const entry = staffEntry(staff, facts)
  const manages = roleHas(staff.role, 'staff.manage')

  /** Whether the change would leave no accepted Super admin: the one rule that keeps the console reachable. */
  const lastSuperAdmin = (m: StaffMemberRow, activeSuperAdmins: number) => m.status === 'active' && m.role_key === superAdmin && activeSuperAdmins <= 1

  const actionsFor = (m: StaffMemberRow, activeSuperAdmins: number) => {
    if (!manages) return { changeRole: refused('SUPER_ADMIN_ONLY'), remove: refused('SUPER_ADMIN_ONLY'), ...(m.status === 'invited' ? { resend: refused('SUPER_ADMIN_ONLY'), revoke: refused('SUPER_ADMIN_ONLY') } : {}) }
    if (m.status === 'invited') return { changeRole: allowed, remove: refused('PENDING_INVITATION'), resend: allowed, revoke: allowed }
    const last = lastSuperAdmin(m, activeSuperAdmins) ? refused('LAST_SUPER_ADMIN') : allowed
    return { changeRole: last, remove: last }
  }

  const memberOf = (m: StaffMemberRow, at: Date, activeSuperAdmins: number) => ({
    id: m.id,
    name: m.status === 'invited' || m.name === '' ? null : m.name,
    email: m.email,
    role: staffRoles.find((r) => r === m.role_key) ?? 'staff-read-only',
    lastSignInAt: m.last_sign_in_at,
    // What the company SSO reported at the last sign-in (decided on #45).
    twoFactor: m.last_sign_in_at === null ? ('notSignedIn' as const) : m.two_factor ? ('on' as const) : ('off' as const),
    invitation: m.status === 'invited' && m.invitation_sent_at && m.invitation_expires_at ? { sentAt: m.invitation_sent_at, expiresAt: m.invitation_expires_at, expired: m.invitation_expires_at <= at } : null,
    actions: actionsFor(m, activeSuperAdmins),
  })
  type MemberDto = ReturnType<typeof memberOf>

  /** Null for a cursor it cannot read. */
  const staffList = async (page: PageRequest): Promise<{ items: MemberDto[]; pageInfo: PageInfo; soleSuperAdmin: boolean } | null> => {
    const decoded = decodePage(page, staffPageSize)
    if (!decoded.ok) return null
    return withScope(sql, context, async (tx) => {
      const rows = await selectStaffPage(tx, decoded, decoded.limit)
      const { rows: pageRows, pageInfo } = pageOf(rows, decoded, (r) => ({ occurredAt: r.created_at, id: r.id }))
      const supers = await countActiveSuperAdmins(tx)
      const at = now()
      return { items: pageRows.map((r) => memberOf(r, at, supers)), pageInfo, soleSuperAdmin: supers <= 1 }
    })
  }

  const throttled = async (tx: ScopedSql, email: string, at: Date) =>
    (await countRecentStaffInvites(tx, new Date(at.getTime() - 3_600_000), { actorId: staff.id })) >= staffInviteLimits.perInviterPerHour ||
    (await countRecentStaffInvites(tx, new Date(at.getTime() - 86_400_000), { email })) >= staffInviteLimits.perAddressPerDay

  /** A fresh link for the member, emailed through the outbox; the deliverer mints its token (ACCESS §6.1). */
  const sendInvitation = async (tx: ScopedSql, memberId: string, email: string, at: Date) => {
    const invitationId = await insertStaffInvitation(tx, { staffUserId: memberId, sentAt: at, expiresAt: new Date(at.getTime() + invitationDays * 86_400_000), by: staff.id })
    await queueSideEffect(tx, { kind: 'email', idempotencyKey: `staff-invitation:${invitationId}`, payload: { template: 'staff-invitation', staffInvitationId: invitationId, to: email }, partnerId: null, storeId: null })
  }

  /** One change at a time, on the member read under the lock (`LAST_SUPER_ADMIN` holds under concurrent requests). */
  const change = (memberId: string, work: (tx: ScopedSql, m: StaffMemberRow, supers: number, at: Date) => Promise<StaffResult>): Promise<StaffResult> => {
    if (!manages) return Promise.resolve({ ok: false, reason: 'SUPER_ADMIN_ONLY' })
    if (!id.safeParse(memberId).success) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return withScope(sql, context, async (tx) => {
      await lockStaffTeam(tx)
      const m = await selectStaffMember(tx, memberId)
      if (!m) return { ok: false, reason: 'NOT_FOUND' }
      return work(tx, m, await countActiveSuperAdmins(tx), now())
    })
  }

  const target = (m: Pick<StaffMemberRow, 'id' | 'email'>) => ({ type: 'staff', id: m.id, label: m.email })

  const inviteStaff = (rawEmail: string, rawRole: string): Promise<StaffResult> => {
    if (!manages) return Promise.resolve({ ok: false, reason: 'SUPER_ADMIN_ONLY' })
    const email = z.email().max(254).safeParse(rawEmail.trim())
    const r = role.safeParse(rawRole)
    if (!email.success || !r.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    return withScope(sql, context, async (tx): Promise<StaffResult> => {
      await lockStaffTeam(tx)
      // Any domain until the company list is configurable; an address already on staff is refused (#45).
      if (await selectStaffByEmail(tx, email.data)) return { ok: false, reason: 'ALREADY_STAFF' }
      const at = now()
      if (await throttled(tx, email.data, at)) return { ok: false, reason: 'RATE_LIMITED' }
      const memberId = await insertInvitedStaff(tx, email.data, r.data)
      await sendInvitation(tx, memberId, email.data, at)
      await activity.record(tx, entry({ action: staffAudit.inviteStaff, target: target({ id: memberId, email: email.data }), reason: null, visibility: 'staff', changes: [{ field: 'role', before: null, after: r.data }] }))
      return { ok: true }
    })
  }

  const changeStaffRole = (memberId: string, rawRole: string) => {
    const r = role.safeParse(rawRole)
    if (!r.success) return Promise.resolve<StaffResult>({ ok: false, reason: 'INVALID_INPUT' })
    return change(memberId, async (tx, m, supers) => {
      if (m.role_key === r.data) return { ok: false, reason: 'SAME_ROLE' }
      if (lastSuperAdmin(m, supers)) return { ok: false, reason: 'LAST_SUPER_ADMIN' }
      await updateStaffRole(tx, m.id, r.data)
      await activity.record(tx, entry({ action: staffAudit.changeStaffRole, target: target(m), reason: null, visibility: 'staff', changes: [{ field: 'role', before: m.role_key, after: r.data }] }))
      return { ok: true }
    })
  }

  // A pending invitation is revoked, not removed: there is no account yet (decided on #45).
  const removeStaff = (memberId: string) =>
    change(memberId, async (tx, m, supers) => {
      if (m.status === 'invited') return { ok: false, reason: 'PENDING_INVITATION' }
      if (lastSuperAdmin(m, supers)) return { ok: false, reason: 'LAST_SUPER_ADMIN' }
      const ended = await markStaffRemoved(tx, m.id)
      await activity.record(tx, entry({ action: staffAudit.removeStaff, target: target(m), reason: null, visibility: 'staff', changes: [{ field: 'status', before: m.status, after: 'removed' }, { field: 'sessions_ended', before: null, after: String(ended) }] }))
      return { ok: true }
    })

  const resendStaffInvite = (memberId: string) =>
    change(memberId, async (tx, m, _supers, at) => {
      if (m.status !== 'invited') return { ok: false, reason: 'NOT_PENDING' }
      if (await throttled(tx, m.email, at)) return { ok: false, reason: 'RATE_LIMITED' }
      await revokeStaffInvitations(tx, m.id, at)
      await sendInvitation(tx, m.id, m.email, at)
      await activity.record(tx, entry({ action: staffAudit.resendStaffInvite, target: target(m), reason: null, visibility: 'staff' }))
      return { ok: true }
    })

  const revokeStaffInvite = (memberId: string) =>
    change(memberId, async (tx, m, _supers, at) => {
      if (m.status !== 'invited') return { ok: false, reason: 'NOT_PENDING' }
      await revokeStaffInvitations(tx, m.id, at)
      await markStaffRemoved(tx, m.id)
      await activity.record(tx, entry({ action: staffAudit.revokeStaffInvite, target: target(m), reason: null, visibility: 'staff' }))
      return { ok: true }
    })

  return { staffList, inviteStaff, changeStaffRole, removeStaff, resendStaffInvite, revokeStaffInvite }
}

export type StaffMembersService = ReturnType<typeof createStaffMembersService>
export type StaffMemberDto = NonNullable<Awaited<ReturnType<StaffMembersService['staffList']>>>['items'][number]
