import { z } from 'zod'
import type { PartnerContext } from '#core/tenancy'

const requester = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('partner-user'), partnerUserId: z.guid() }).strict(),
  z.object({ kind: z.literal('impersonation'), partnerUserId: z.guid(), staffId: z.guid(), impersonationId: z.guid() }).strict(),
  z.object({ kind: z.literal('staff-setup'), staffId: z.guid(), setupSessionId: z.guid() }).strict(),
])

// An export job reads in the scope of whoever asked for it (#243: a staff session too). Payloads
// queued before that name only the partner user.
export const exportPayload = z.union([
  z.object({ jobId: z.guid(), partnerId: z.guid(), requester }).strict(),
  z.object({ jobId: z.guid(), partnerId: z.guid(), partnerUserId: z.guid() }).strict(),
])

export const exportScope = (payload: z.infer<typeof exportPayload>): PartnerContext => ({
  caller: 'requester' in payload ? payload.requester : { kind: 'partner-user', partnerUserId: payload.partnerUserId },
  partnerId: payload.partnerId,
})
