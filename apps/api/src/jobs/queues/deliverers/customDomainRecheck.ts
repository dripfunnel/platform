import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { partnerOfStore, selectCustomDomainById, selectCustomDomainForUpdate, updateCustomDomainCheck } from '#db/scoped/stores'
import type { CloudflareApi } from '#integrations/cloudflare/api'
import type { DnsLookup } from '#integrations/dns/doh'
import { activityLog } from '#saas/activity/index'
import { judge, queueHostPurge, registerHostname } from '#saas/domains/index'
import type { Deliverer } from '../outbox-relay'

const payload = z.object({ storeId: z.guid(), customDomainId: z.guid() }).strict()

/**
 * `custom_domain.recheck`: a merchant's own hostname (SAAS.md §8). The CNAME to our edge decides
 * until it passes; from then on the state is Cloudflare for SaaS's, as for a portal host.
 */
export const customDomainRecheckDeliverer = (sql: postgres.Sql, lookup: DnsLookup, now: () => Date = () => new Date(), cloudflare: CloudflareApi | null = null): Deliverer => ({
  deliver: async (effect, signal) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('custom_domain.recheck: bad payload')
    const { storeId, customDomainId } = parsed.data
    const heldBy = async () => (await withSystemScope(sql, (tx) => selectCustomDomainById(tx, customDomainId)))?.store_id === storeId
    const found = await withSystemScope(sql, async (tx) => {
      const domain = await selectCustomDomainById(tx, customDomainId)
      return domain && domain.store_id === storeId ? { domain, partnerId: await partnerOfStore(tx, domain.store_id) } : null
    })
    if (!found) return
    const { domain, partnerId } = found
    const [cnames, txts] = await Promise.all([lookup.resolve(domain.host, 'CNAME', signal), lookup.resolve(`_df-verify.${domain.host}`, 'TXT', signal)])
    const cname = judge(domain.status, domain.expected_cname, cnames)
    const ownership = txts.find((t) => t === domain.ownership_token) ?? null
    let status = cname.status
    if (status === 'live' && cloudflare) {
      const registered = await registerHostname(cloudflare, domain.host, heldBy)
      if (registered === null) return
      status = registered
    }
    const at = now()
    await withSystemScope(sql, async (tx) => {
      // Locked, so two checks at once agree on what changed: one entry and one purge per change.
      const current = await selectCustomDomainForUpdate(tx, domain.id)
      if (!current || current.store_id !== storeId) return
      await updateCustomDomainCheck(tx, domain.id, { status, foundCname: cname.found, ownershipFound: ownership, checkedAt: at })
      if (status === current.status) return
      if (status === 'live') await queueHostPurge(tx, { id: domain.id, storeId, partnerId, host: domain.host }, 'live', at)
      await activityLog.record(tx, {
        category: 'system',
        action: 'store.domain_status_changed',
        result: 'success',
        actorKind: 'job',
        actorId: 'custom_domain.recheck',
        actorLabel: 'Domain check',
        partnerId,
        storeId,
        target: { type: 'domain', id: domain.id, label: domain.host },
        changes: [{ field: 'status', before: current.status, after: status }],
        reason: null,
        api: 'system',
        requestId: null,
        ip: null,
        userAgent: null,
        // Account-level (LOGGING.md §6): the partner and the merchant both read it.
        visibility: 'partner',
      })
    })
  },
})
