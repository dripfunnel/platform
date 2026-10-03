import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { insertOutboxMany } from '#db/scoped/outbox'
import { selectDuePartnerDomains } from '#db/scoped/partnerDomains'

// SAAS §8 and FIRST-RELEASE §9.2: a waiting (or failed) partner address is checked every 10 minutes. Each
// run queues the existing `domain.recheck`; the key is per address and per 10-minute window, so
// a run repeated within the window queues nothing new.
const intervalMs = 10 * 60 * 1000
const perRun = 200

export const queueDueDomainChecks = (sql: postgres.Sql, now: Date): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    const due = await selectDuePartnerDomains(tx, new Date(now.getTime() - intervalMs), perRun)
    const window = Math.floor(now.getTime() / intervalMs)
    await insertOutboxMany(
      tx,
      due.map((d) => ({ kind: 'domain.recheck', idempotencyKey: `${d.id}:scheduled:${window}`, payload: { partnerId: d.partner_id, domainId: d.id }, partnerId: d.partner_id, storeId: null })),
    )
    return due.length
  })
