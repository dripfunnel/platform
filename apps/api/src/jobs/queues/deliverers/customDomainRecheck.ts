import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { partnerOfStore, selectCustomDomainById, updateCustomDomainCheck } from '#db/scoped/stores'
import type { DnsLookup } from '#integrations/dns/doh'
import { activityLog } from '#saas/activity/index'
import { judge } from '#saas/domains/index'
import type { Deliverer } from '../outbox-relay'

const payload = z.object({ storeId: z.guid(), customDomainId: z.guid() }).strict()

/**
 * `custom_domain.recheck`: a merchant's own hostname (SAAS.md §8). The CNAME to our edge decides
 * the status; the ownership TXT is recorded for the certificate step that arrives with the
 * Cloudflare for SaaS integration.
 */
export const customDomainRecheckDeliverer = (sql: postgres.Sql, lookup: DnsLookup, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect, signal) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('custom_domain.recheck: bad payload')
    const found = await withSystemScope(sql, async (tx) => {
      const domain = await selectCustomDomainById(tx, parsed.data.customDomainId)
      return domain && domain.store_id === parsed.data.storeId ? { domain, partnerId: await partnerOfStore(tx, domain.store_id) } : null
    })
    if (!found) return
    const { domain, partnerId } = found
    const [cnames, txts] = await Promise.all([lookup.resolve(domain.host, 'CNAME', signal), lookup.resolve(`_df-verify.${domain.host}`, 'TXT', signal)])
    const cname = judge(domain.status, domain.expected_cname, cnames)
    const ownership = txts.find((t) => t === domain.ownership_token) ?? null
    const status = cname.status
    await withSystemScope(sql, async (tx) => {
      await updateCustomDomainCheck(tx, domain.id, { status, foundCname: cname.found, ownershipFound: ownership, checkedAt: now() })
      if (status !== domain.status) {
        await activityLog.record(tx, {
          category: 'system',
          action: 'store.domain_status_changed',
          result: 'success',
          actorKind: 'job',
          actorId: 'custom_domain.recheck',
          actorLabel: 'Domain check',
          partnerId,
          storeId: domain.store_id,
          target: { type: 'domain', id: domain.id, label: domain.host },
          changes: [{ field: 'status', before: domain.status, after: status }],
          reason: null,
          api: 'system',
          requestId: null,
          ip: null,
          userAgent: null,
          // Account-level (LOGGING.md §6): the partner and the merchant both read it.
          visibility: 'partner',
        })
      }
    })
  },
})
