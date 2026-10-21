import type postgres from 'postgres'
import { withSystemScope } from '#db/scoped/index'
import { insertOutboxMany } from '#db/scoped/outbox'
import { ratesRefreshKind } from './deliverers/ratesRefresh'

// The ECB publishes once a working day (integrations/ecb): asking every six hours catches each day's file
// within hours, and the key keeps a window to one request however often the cron runs.
const windowMs = 6 * 60 * 60 * 1000

export const queueRatesRefresh = (sql: postgres.Sql, now: Date): Promise<void> =>
  withSystemScope(sql, async (tx) => {
    await insertOutboxMany(tx, [{ kind: ratesRefreshKind, idempotencyKey: `rates:${Math.floor(now.getTime() / windowMs)}`, payload: {}, partnerId: null, storeId: null }])
  })
