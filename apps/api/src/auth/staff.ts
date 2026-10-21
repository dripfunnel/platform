import type { ScopedSql } from '#db/scoped/index'
import { acceptStaffInvitation, lockStaffTeam, selectStaffInvitationByToken, subjectTaken, type InvitationForAccept } from '#db/scoped/staffMembers'
import type { IdentityClaims } from './oidc'
import { SignInFailed } from './oidc'

export const staffRoles = [
  'staff-super-admin',
  'staff-partner-manager',
  'staff-support',
  'staff-finance',
  'staff-engineer',
  'staff-read-only',
] as const

export type StaffRole = (typeof staffRoles)[number]

export interface StaffMember {
  id: string
  email: string
  name: string
  role: StaffRole
}

/**
 * The provider says who someone is; this says whether they work here. Unknown and suspended
 * raise the same detail-free refusal, so neither can be told from the other (CONSOLE-DESIGN A1).
 */
export const staffForClaims = async (tx: ScopedSql, claims: Pick<IdentityClaims, 'subject'>): Promise<StaffMember> => {
  const rows = await tx<{ id: string; email: string; name: string; role_key: StaffRole; status: string }[]>`
    select id, email, name, role_key, status from staff_user where sso_subject = ${claims.subject}
  `
  const row = rows[0]
  if (!row) throw new SignInFailed('unknown_subject')
  if (row.status === 'suspended') throw new SignInFailed('staff_suspended')
  if (row.status !== 'active') throw new SignInFailed('staff_not_active')
  return { id: row.id, email: row.email, name: row.name, role: row.role_key }
}

export const staffById = async (tx: ScopedSql, id: string): Promise<StaffMember | null> => {
  const rows = await tx<{ id: string; email: string; name: string; role_key: StaffRole; status: string }[]>`
    select id, email, name, role_key, status from staff_user where id = ${id} and status = 'active'
  `
  const row = rows[0]
  return row ? { id: row.id, email: row.email, name: row.name, role: row.role_key } : null
}

/** An invitation's link works while it is neither used, revoked nor expired, for someone still invited. */
export const invitationOpen = (i: InvitationForAccept | null, now: Date): i is InvitationForAccept =>
  i !== null && i.accepted_at === null && i.revoked_at === null && i.expires_at > now && i.status === 'invited'

/**
 * Binds the SSO account to the invited member on first sign-in (ui/admin/FIRST-RELEASE.md §10):
 * once, before it expires, and only for the address the invitation was sent to.
 */
export const acceptInvitation = async (tx: ScopedSql, tokenHash: string, claims: IdentityClaims, now: Date): Promise<StaffMember> => {
  // The Staff menu's lock: a revoke or resend at the same moment waits, then sees the member active.
  await lockStaffTeam(tx)
  const invitation = await selectStaffInvitationByToken(tx, tokenHash)
  if (!invitationOpen(invitation, now) || (await subjectTaken(tx, claims.subject))) throw new SignInFailed('invitation_invalid')
  if (invitation.email.toLowerCase() !== claims.email.toLowerCase()) throw new SignInFailed('invitation_email_mismatch')
  await acceptStaffInvitation(tx, { invitationId: invitation.id, staffUserId: invitation.staff_user_id, subject: claims.subject, name: claims.name, twoFactor: claims.twoFactor, at: now })
  const role = staffRoles.find((r) => r === invitation.role_key)
  if (!role) throw new SignInFailed('invitation_invalid')
  return { id: invitation.staff_user_id, email: invitation.email, name: claims.name, role }
}
