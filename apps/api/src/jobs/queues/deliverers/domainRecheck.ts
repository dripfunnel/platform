import type postgres from 'postgres'
import { z } from 'zod'
import { withSystemScope } from '#db/scoped/index'
import { selectPartnerDomainById, updatePartnerDomainCheck } from '#db/scoped/partners'
import type { DnsLookup } from '#integrations/dns/doh'
import { activityLog } from '#saas/activity/index'
import { checkDomain } from '#saas/domains/check'
import type { Deliverer } from '../outbox-relay'

const payload = z.object({ partnerId: z.guid(), domainId: z.guid() }).strict()

/**
 * `domain.recheck`: the lookup SAAS.md §8 step 3 describes, run after commit with the relay's
 * timeout and retries, never inside the request that asked for it. The result is a row update
 * and a system entry the partner can see.
 */
export const domainRecheckDeliverer = (sql: postgres.Sql, lookup: DnsLookup, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect, signal) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new Error('domain.recheck: bad payload')
    const domain = await withSystemScope(sql, (tx) => selectPartnerDomainById(tx, parsed.data.domainId))
    if (!domain || domain.partner_id !== parsed.data.partnerId) return
    const check = await checkDomain(domain, lookup, signal)
    await withSystemScope(sql, async (tx) => {
      await updatePartnerDomainCheck(tx, domain.id, { ...check, checkedAt: now() })
      if (check.status !== domain.status) {
        await activityLog.record(tx, {
          category: 'system',
          action: 'partner.domain_status_changed',
          result: 'success',
          actorKind: 'job',
          actorId: 'domain.recheck',
          actorLabel: 'Domain check',
          partnerId: domain.partner_id,
          target: { type: 'domain', id: domain.id, label: domain.host },
          changes: [{ field: 'status', before: domain.status, after: check.status }],
          reason: null,
          api: 'system',
          requestId: null,
          ip: null,
          userAgent: null,
          visibility: 'partner',
        })
      }
    })
  },
})
