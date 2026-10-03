import type { ActivityEntry, RequestFacts } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'

/** An entry with the partner user as actor, in their partner's scope, and the request's facts (LOGGING.md §4). */
export const partnerEntry =
  (caller: PartnerCaller, facts: RequestFacts) =>
  (fields: Pick<ActivityEntry, 'action' | 'reason' | 'target'> & Partial<ActivityEntry>): ActivityEntry => ({
    category: 'write',
    result: 'success',
    actorKind: 'partner_user',
    actorId: caller.user.id,
    actorLabel: `${caller.user.name} <${caller.user.email}>`,
    partnerId: caller.partner.id,
    api: 'platform',
    visibility: 'partner',
    ...facts,
    ...fields,
  })
