import { secondsLeft } from '@dripfunnel/shared/ui'
import type { ImpersonationTarget, Membership, SessionMembership, SessionRefusal, StaffSession } from '../../api/impersonation'
import { fill, formatWait, messages } from '../../messages'

const words = messages.impersonate

export const roleText = (membership: Membership | SessionMembership): string => {
  const role = words.roles[membership.role]
  return membership.level === 'store' && membership.supplier ? fill(words.where.supplierRole, { role, supplier: membership.supplier }) : role
}

export const whereText = (membership: Membership | SessionMembership): string =>
  membership.level === 'partner' ? fill(words.where.partner, { partner: membership.partner.name }) : membership.store.name

export const membershipLine = (membership: Membership): string => fill(words.where.line, { where: whereText(membership), role: roleText(membership) })

// Where everyone signed in sees the banner.
export const placeText = (membership: Membership | SessionMembership): string =>
  membership.level === 'partner' ? fill(words.where.partnerConsole, { partner: membership.partner.name }) : membership.store.name

export const firstOf = (name: string): string => name.split(' ')[0] ?? name

export const timeLeftText = (expiresAt: string, now: number): string => formatWait(secondsLeft(expiresAt, now))

// The API's refusal in the console's words; an inactive target says which way it isn't active.
export const refusalText = (reason: SessionRefusal, target?: Pick<ImpersonationTarget, 'name' | 'status'>): string => {
  if (reason === 'TARGET_NOT_ACTIVE' && target) {
    const name = firstOf(target.name)
    if (target.status === 'invited') return fill(words.refusals.TARGET_INVITED, { name })
    if (target.status === 'suspended') return fill(words.refusals.TARGET_SUSPENDED, { name })
    return fill(words.refusals.TARGET_NOT_ACTIVE, { name })
  }
  return fill(words.refusals[reason], { name: target ? firstOf(target.name) : '' })
}

// Who did what, in one line: "Neha Rao as Rohan Verma", or "Maya Ortiz setting up Tallis Studio".
export const sessionTitle = (session: StaffSession): string =>
  session.kind === 'impersonation' && session.target
    ? fill(words.sessions.row.as, { staff: session.staff.name, target: session.target.name })
    : fill(words.sessions.row.setupFor, { staff: session.staff.name, partner: session.partner.name })

export const sessionPlace = (session: StaffSession): string =>
  session.membership ? placeText(session.membership) : fill(words.where.partnerConsole, { partner: session.partner.name })
