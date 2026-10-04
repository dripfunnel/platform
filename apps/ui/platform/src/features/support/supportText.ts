import type { Reauth, SupportRefusal, SupportSession, SupportTarget } from '../../api/support'
import type { PartnerRole } from '../shell/partnerRoles'
import { fill, messages } from '../../messages'
import { roleOf } from '../common/storeRoles'

const words = messages.support

// Owners, Admins and Support have Support (§12); the API's `support.session` refuses the rest too.
export const supportAllowed = (role: PartnerRole): boolean => role === 'partner-owner' || role === 'partner-admin' || role === 'partner-support'

// Whether a store's Support tab offers a start: a partner user's own session, never a staff one (ACCESS.md §8.2).
export const supportStartOffered = (role: PartnerRole, staffSessionOpen: boolean): boolean => supportAllowed(role) && !staffSessionOpen

export const firstOf = (name: string): string => name.split(' ')[0] ?? name

// "Owner", or "Supplier admin for Loomcraft" (§12.1).
export const roleText = ({ role, supplier }: { role: string; supplier: string | null }): string =>
  supplier ? fill(words.supplierRole, { role: roleOf(role), supplier }) : roleOf(role)

// §12.1's sentences, with the facts the API sends beside each code.
export const refusalText = (reason: SupportRefusal, target?: SupportTarget): string => {
  const values = { store: target?.store.name ?? '', user: target ? firstOf(target.name) : '', owner: target?.storeOwner ?? '' }
  if (reason === 'SUPPORT_OFF' && !target?.storeOwner) return fill(words.refusals.SUPPORT_OFF_NO_OWNER, values)
  if (reason === 'COLLEAGUE_IN_SESSION') {
    const colleague = target?.colleague
    return colleague ? fill(words.refusals.COLLEAGUE_IN_SESSION, { ...values, colleague: colleague.name, minutes: String(colleague.minutesLeft) }) : fill(words.refusals.COLLEAGUE_IN_SESSION_NO_NAME, values)
  }
  return fill(words.refusals[reason], values)
}

export const minutesLeft = (expiresAt: string, now: number): number => Math.max(0, Math.ceil((Date.parse(expiresAt) - now) / 60_000))

export const whereText = (session: SupportSession): string => `${session.store.name} · ${roleText(session.user)}`

export const reauthText = (r: Extract<Reauth, { ok: false }>): string => {
  const reauth = words.start.reauth
  if (r.reason === 'WRONG_CODE') return r.triesLeft ? fill(reauth.WRONG_CODE, { tries: String(r.triesLeft) }) : reauth.WRONG_CODE_LAST
  if (r.reason === 'LOCKED') return r.lockedMinutes ? fill(reauth.LOCKED, { minutes: String(r.lockedMinutes) }) : reauth.LOCKED_NO_TIME
  return reauth[r.reason]
}
