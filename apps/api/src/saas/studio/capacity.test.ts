import { describe, expect, it } from 'vitest'
import { capacityLedger, leaseMs, queueMs, type LedgerStorage } from './capacity'

const storage = (): LedgerStorage => {
  const map = new Map<string, unknown>()
  return {
    get: async <T>(key: string) => map.get(key) as T | undefined,
    put: async (key, value) => void map.set(key, value),
    delete: async (key) => map.delete(key),
    list: async <T>({ prefix }: { prefix: string }) => new Map([...map].filter(([k]) => k.startsWith(prefix)) as [string, T][]),
  }
}

describe('the studio capacity ledger (storefront AI-STUDIO §7)', () => {
  it('queues a studio at the limit, reports its place, and lets it in when one stops', async () => {
    const ledger = capacityLedger(storage(), 2)
    expect(await ledger.acquire('a', 0)).toEqual({ granted: true })
    expect(await ledger.acquire('b', 1)).toEqual({ granted: true })
    expect(await ledger.acquire('c', 2)).toEqual({ granted: false, place: 1 })
    expect(await ledger.acquire('d', 3)).toEqual({ granted: false, place: 2 })
    // Asking again keeps the place it first had.
    expect(await ledger.acquire('c', 10)).toEqual({ granted: false, place: 1 })
    await ledger.release('a')
    // The free room is c's, who asked first, so d is next after it.
    expect(await ledger.acquire('d', 11)).toEqual({ granted: false, place: 1 })
    expect(await ledger.acquire('c', 12)).toEqual({ granted: true })
    expect(await ledger.acquire('d', 13)).toEqual({ granted: false, place: 1 })
  })

  it('renews a running studio’s lease, and frees a lease or a place nobody renews', async () => {
    const ledger = capacityLedger(storage(), 1)
    expect(await ledger.acquire('a', 0)).toEqual({ granted: true })
    expect(await ledger.acquire('a', leaseMs - 1)).toEqual({ granted: true })
    expect(await ledger.acquire('b', leaseMs)).toEqual({ granted: false, place: 1 })
    expect(await ledger.acquire('c', leaseMs + 1)).toEqual({ granted: false, place: 2 })
    // a stopped renewing (its container died), b's tab closed: c is next, then in.
    expect(await ledger.acquire('c', 2 * leaseMs + queueMs)).toEqual({ granted: true })
  })
})
