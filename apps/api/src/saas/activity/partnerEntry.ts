import type { ActivityEntry, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'

const labelOf = (person: { name: string; email: string }) => `${person.name} <${person.email}>`

// LOGGING.md §4: an impersonation's actor is the user acted as, with the staff member on whose
// behalf; a setup session's is the staff member. Both carry the session in `access`.
const attributionOf = (caller: PartnerCaller): Pick<ActivityEntry, 'actorKind' | 'actorId' | 'actorLabel' | 'onBehalfOf' | 'access'> => {
  const { user, staff } = caller
  if (staff?.session.kind === 'setup') return { actorKind: 'staff', actorId: staff.id, actorLabel: labelOf(staff), onBehalfOf: null, access: { kind: 'setup_session', id: staff.session.id } }
  if (!user) throw new Error('partnerEntry: a partner caller with neither a user nor a setup session')
  const own = { actorKind: 'partner_user' as const, actorId: user.id, actorLabel: labelOf(user) }
  if (!staff) return { ...own, onBehalfOf: null, access: null }
  return { ...own, onBehalfOf: { kind: 'staff', id: staff.id, label: labelOf(staff) }, access: { kind: 'impersonation', id: staff.session.id } }
}

/** An entry attributed to the caller, in their partner's scope, with the request's facts (LOGGING.md §4). */
export const partnerEntry =
  (caller: PartnerCaller, facts: RequestFacts) =>
  (fields: Pick<ActivityEntry, 'action' | 'reason' | 'target'> & Partial<ActivityEntry>): ActivityEntry => ({
    category: 'write',
    result: 'success',
    ...attributionOf(caller),
    partnerId: caller.partner.id,
    api: 'platform',
    visibility: 'partner',
    ...facts,
    ...fields,
  })
