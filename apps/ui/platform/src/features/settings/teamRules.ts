import type { TeamMember } from '../../api/settings'
import type { PartnerRole } from '../shell/partnerRoles'
import { messages } from '../../messages'

export type StaffSessionKind = 'impersonation' | 'setup' | null

const refused = messages.settings.team.refused

// What the caller may do to the team (FIRST-RELEASE §14.2, ACCESS §5.3), so a control shows its
// reason before anyone presses it; the API refuses the same, under the team lock.
export const mayManage = (role: PartnerRole): boolean => role === 'partner-owner' || role === 'partner-admin'

export const owners = (team: readonly TeamMember[]) => team.filter((member) => member.role === 'partner-owner' && member.status === 'active')

export const isLastOwner = (member: TeamMember, team: readonly TeamMember[]): boolean => member.role === 'partner-owner' && member.status === 'active' && owners(team).length <= 1

// ACCESS.md §8.1, §8.2: who is Owner stays the partner's own decision, never a staff session's.
export const ownerBlock = (session: StaffSessionKind): string | null =>
  session === 'impersonation' ? messages.settings.team.refusals.BLOCKED_WHILE_IMPERSONATING : session === 'setup' ? messages.settings.team.refusals.PARTNER_ENTERS_THIS_ITSELF : null

// Why this member's role can't be changed by the caller; null when it can.
export const roleRefusal = (member: TeamMember, team: readonly TeamMember[], role: PartnerRole, session: StaffSessionKind = null): string | null => {
  if (!mayManage(role)) return refused.manage
  if (member.role === 'partner-owner' && ownerBlock(session)) return ownerBlock(session)
  if (member.you) return refused.selfRole
  if (member.role === 'partner-owner' && role !== 'partner-owner') return refused.ownerRole
  if (isLastOwner(member, team)) return refused.lastOwner
  return null
}

export const removeRefusal = (member: TeamMember, team: readonly TeamMember[], role: PartnerRole, session: StaffSessionKind = null): string | null => {
  if (!mayManage(role)) return refused.manage
  if (member.role === 'partner-owner' && ownerBlock(session)) return ownerBlock(session)
  if (member.you) return refused.self
  if (member.role === 'partner-owner' && role !== 'partner-owner') return refused.ownerRole
  if (isLastOwner(member, team)) return refused.lastOwner
  return null
}

// The roles the caller may give: Owner only by an Owner, and never in a staff session.
export const rolesFor = (role: PartnerRole, all: readonly PartnerRole[], session: StaffSessionKind = null): readonly PartnerRole[] =>
  role === 'partner-owner' && !ownerBlock(session) ? all : all.filter((r) => r !== 'partner-owner')

// Who can take over: an active member who isn't the Owner already.
export const transferCandidates = (team: readonly TeamMember[]) => team.filter((member) => member.status === 'active' && member.role !== 'partner-owner')
