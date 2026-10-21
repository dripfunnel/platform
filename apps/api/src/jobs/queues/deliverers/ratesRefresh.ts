import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { upsertRates } from '#db/scoped/rates'
import type { RatesSource } from '#integrations/ecb/rates'
import type { Deliverer } from '../outbox-relay'

export const ratesRefreshKind = 'rates.refresh'

// The reference rates, fetched under the relay's timeout; a failure throws, so the relay retries with its backoff
// and limit (AGENTS.md "Reliability"), and the rates held keep serving until then (CATALOG O5).
export const ratesRefreshDeliverer = (sql: postgres.Sql, source: RatesSource, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (_effect, signal) => {
    const rates = await source.fetch(signal)
    await withSystemScope(sql, (tx) => upsertRates(tx, rates, now()))
  },
})
