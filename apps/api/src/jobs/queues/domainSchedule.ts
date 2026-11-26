import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { insertOutboxMany } from '#db/scoped/outbox'
import { selectDuePartnerDomains } from '#db/scoped/partnerDomains'
import { selectDueCustomDomains } from '#db/scoped/stores'

// SAAS §8: partner addresses every 10 minutes (FIRST-RELEASE §9.2), merchant domains every 15 (DATA-MODEL §7.2).
// The key is per address and per window, so a run repeated within the window queues nothing new.
const partnerIntervalMs = 10 * 60 * 1000
const merchantIntervalMs = 15 * 60 * 1000
const perRun = 200

export const queueDueDomainChecks = (sql: postgres.Sql, now: Date): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    const partners = await selectDuePartnerDomains(tx, new Date(now.getTime() - partnerIntervalMs), perRun)
    const partnerWindow = Math.floor(now.getTime() / partnerIntervalMs)
    const merchants = await selectDueCustomDomains(tx, new Date(now.getTime() - merchantIntervalMs), perRun)
    const merchantWindow = Math.floor(now.getTime() / merchantIntervalMs)
    await insertOutboxMany(tx, [
      ...partners.map((d) => ({ kind: 'domain.recheck', idempotencyKey: `${d.id}:scheduled:${partnerWindow}`, payload: { partnerId: d.partner_id, domainId: d.id }, partnerId: d.partner_id, storeId: null })),
      ...merchants.map((d) => ({ kind: 'custom_domain.recheck', idempotencyKey: `${d.id}:scheduled:${merchantWindow}`, payload: { storeId: d.store_id, customDomainId: d.id }, partnerId: d.partner_id, storeId: d.store_id })),
    ])
    return partners.length + merchants.length
  })
