import { keptChanges, type KeptStorage } from '#saas/studio/index'

/** A Durable Object's storage in memory, as the studio's kept changes use it: keys listed in order, at most 128 to a write. */
export const memoryKept = () => {
  const data = new Map<string, unknown>()
  const storage: KeptStorage = {
    list: async ({ prefix }) => new Map([...data].filter(([k]) => k.startsWith(prefix)).sort(([a], [b]) => (a < b ? -1 : 1))),
    put: async (entries) => {
      if (Object.keys(entries).length > 128) throw new Error('storage: more than 128 keys')
      for (const [k, v] of Object.entries(entries)) data.set(k, structuredClone(v))
    },
    delete: async (keys) => keys.filter((k) => data.delete(k)).length,
  }
  return { storage, data }
}

/** A StudioRunner's own storage for a test: its kept changes in memory, a save's retries at once. */
export const studioStorage = (kept = memoryKept()) => ({ kept: keptChanges(kept.storage), background: () => undefined, sleep: async () => undefined })
