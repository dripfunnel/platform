import type { HostStatus } from '#db/schema/saas'
import type { ScopedSql } from '#db/scoped/index'
import { CloudflareRefused, hostStatusOf, type CloudflareApi } from '#integrations/cloudflare/api'
import { queueSideEffect } from '#saas/outbox/index'

/**
 * Once DNS points at us, a host's state is Cloudflare's own: verifying, issuing, live (SAAS §8).
 * Null when the address was removed meanwhile, so nothing stays registered for it.
 */
export const registerHostname = async (cloudflare: CloudflareApi, host: string, stillHeld: () => Promise<boolean>): Promise<HostStatus | null> => {
  // A removal can commit during the DNS lookup; registering then would orphan the host in Cloudflare.
  if (!(await stillHeld())) return null
  try {
    const status = hostStatusOf(await cloudflare.ensureHostname(host))
    // A removal can also commit between the check above and the registration, after its `domain.remove` ran.
    if (!(await stillHeld())) {
      await cloudflare.removeHostname(host)
      return null
    }
    return status
  } catch (error) {
    // A refusal (bad host, token) will not change by retrying; an outage throws and the relay retries.
    if (!(error instanceof CloudflareRefused)) throw error
    return 'failed'
  }
}

export interface MerchantHost {
  id: string
  storeId: string
  partnerId: string | null
  host: string
}

/** The edge Worker's best-effort purge of a host's lookup (LIVE-SHOP §5 step 1); delivered by #317's `cache.purge`. */
export const queueHostPurge = (tx: ScopedSql, domain: MerchantHost, change: 'live' | 'removed', at: Date): Promise<string | null> =>
  queueSideEffect(tx, {
    kind: 'cache.purge',
    idempotencyKey: `custom-domain-${change}:${domain.id}:${at.toISOString()}`,
    payload: { storeId: domain.storeId, host: domain.host, reason: `domain-${change}` },
    partnerId: domain.partnerId,
    storeId: domain.storeId,
  })

/** What a merchant domain's removal queues in its own transaction (SAAS §8): Cloudflare's removal and the purge. */
export const queueMerchantDomainRemoval = async (tx: ScopedSql, domain: MerchantHost, at: Date): Promise<void> => {
  await queueSideEffect(tx, { kind: 'domain.remove', idempotencyKey: `custom-domain:${domain.id}:removed`, payload: { host: domain.host }, partnerId: domain.partnerId, storeId: domain.storeId })
  await queueHostPurge(tx, domain, 'removed', at)
}
