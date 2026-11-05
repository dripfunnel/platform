import type postgres from 'postgres'
import { describe, expect, it } from 'vitest'
import { defaultRelayOptions } from '../outbox-relay'
import { catalogImportDeliverer } from './catalogImport'

describe('the import deliverer', () => {
  it('has its own delivery limit, longer than the relay default, so a chunk away from the database is not cut off (#1300)', () => {
    const deliverer = catalogImportDeliverer({} as postgres.Sql, null, null)
    expect(deliverer.timeoutMs ?? 0).toBeGreaterThan(defaultRelayOptions.timeoutMs)
  })
})
