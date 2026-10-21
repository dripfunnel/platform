import { z } from 'zod'
import type { TenantContext } from '#core/tenancy'

// A catalogue job's outbox payload (exports.ts, imports.ts): the job, and the scope of whoever asked, which the
// job reads and writes in. A person's session is left out, since nothing reads it there.

const caller = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('person'), userId: z.guid() }).strict(),
  z.object({ kind: z.literal('impersonation'), impersonationId: z.guid(), staffId: z.guid(), userId: z.guid() }).strict(),
  z.object({ kind: z.literal('support'), supportSessionId: z.guid(), partnerUserId: z.guid(), access: z.enum(['read', 'write']) }).strict(),
])

export const catalogJobPayload = z
  .object({
    jobId: z.guid(),
    partnerId: z.guid(),
    storeId: z.guid(),
    caller,
    sellerId: z.guid().nullable(),
    subscription: z.enum(['trial', 'active', 'past_due', 'cancelled', 'suspended']),
  })
  .strict()
export type CatalogJobPayload = z.infer<typeof catalogJobPayload>

export const jobContextOf = (p: CatalogJobPayload): TenantContext => ({
  caller: p.caller.kind === 'person' ? { kind: 'person', userId: p.caller.userId, sessionId: '' } : p.caller,
  partnerId: p.partnerId,
  storeId: p.storeId,
  sellerScope: p.sellerId ? { kind: 'seller', sellerId: p.sellerId } : { kind: 'all' },
  subscription: p.subscription,
})

/** The payload for a job `context` asks for; null for a caller no job runs as (a shopper, a key, an app). */
export const jobPayloadOf = (context: TenantContext, jobId: string): CatalogJobPayload | null => {
  const c = context.caller
  const by = c.kind === 'person' ? { kind: 'person' as const, userId: c.userId } : c.kind === 'impersonation' || c.kind === 'support' ? c : null
  if (!by) return null
  return { jobId, partnerId: context.partnerId, storeId: context.storeId, caller: by, sellerId: context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null, subscription: context.subscription }
}
