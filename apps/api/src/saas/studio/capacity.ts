// How many studios run at once across the account (storefront AI-STUDIO §7): the containers' scheduling policy has no
// max_instances, so one Durable Object keeps this ledger. A store holds a lease while its container runs, renewed each
// minute; a store waiting asks again while its studio is open and keeps its place by the time it first asked.

export interface LedgerStorage {
  get: <T>(key: string) => Promise<T | undefined>
  put: <T>(key: string, value: T) => Promise<void>
  delete: (key: string) => Promise<boolean>
  list: <T>(options: { prefix: string }) => Promise<Map<string, T>>
}

/** STUDIO_MAX_RUNNING when unset: short of the ~6,000 `basic` containers the account's 1,500 vCPU allow (AI-STUDIO §9). */
export const defaultStudioCapacity = 5000

/** A lease not renewed for this long is a container that stopped without saying so. */
export const leaseMs = 3 * 60 * 1000
/** A waiting studio that stopped asking (its tab closed) leaves the queue after this. */
export const queueMs = 60 * 1000

type Waiting = { since: number; seenAt: number }

export type Grant = { granted: true } | { granted: false; place: number }

export const capacityLedger = (storage: LedgerStorage, limit: number) => {
  const prune = async (now: number) => {
    const running = await storage.list<number>({ prefix: 'run:' })
    for (const [key, until] of running) if (until <= now) await storage.delete(key)
    const waiting = await storage.list<Waiting>({ prefix: 'wait:' })
    for (const [key, w] of waiting) if (w.seenAt + queueMs <= now) await storage.delete(key)
  }
  return {
    /** A lease for the store, renewed if it has one, or its place in the queue (1 is next). */
    acquire: async (storeId: string, now: number): Promise<Grant> => {
      await prune(now)
      if ((await storage.get<number>(`run:${storeId}`)) !== undefined) {
        await storage.put(`run:${storeId}`, now + leaseMs)
        return { granted: true }
      }
      const free = limit - (await storage.list<number>({ prefix: 'run:' })).size
      const mine = (await storage.get<Waiting>(`wait:${storeId}`)) ?? { since: now, seenAt: now }
      const ahead = [...(await storage.list<Waiting>({ prefix: 'wait:' }))].filter(([key, w]) => key !== `wait:${storeId}` && (w.since < mine.since || (w.since === mine.since && key < `wait:${storeId}`))).length
      if (ahead < free) {
        await storage.delete(`wait:${storeId}`)
        await storage.put(`run:${storeId}`, now + leaseMs)
        return { granted: true }
      }
      await storage.put(`wait:${storeId}`, { since: mine.since, seenAt: now })
      return { granted: false, place: ahead - free + 1 }
    },
    release: async (storeId: string): Promise<void> => {
      await storage.delete(`run:${storeId}`)
      await storage.delete(`wait:${storeId}`)
    },
  }
}
