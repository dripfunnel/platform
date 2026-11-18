import type { KeptStorage } from './kept'

// Design runs' held requests in the store's StudioSession (storefront AI-STUDIO §4 "A design run"): one per run, taken
// once by its job; one older than a day is dropped whenever the object holds or takes one.

const prefix = 'held:'
export const heldMs = 24 * 60 * 60_000

type Held = { at: number; input: unknown }

export const heldRuns = (storage: KeptStorage, now: () => number) => {
  /** The held requests, those past `heldMs` deleted first. */
  const fresh = async (): Promise<Map<string, unknown>> => {
    const all = await storage.list({ prefix })
    const old = [...all].filter(([, held]) => now() - (held as Held).at > heldMs).map(([key]) => key)
    if (old.length > 0) await storage.delete(old)
    for (const key of old) all.delete(key)
    return all
  }
  return {
    hold: async (run: string, input: unknown): Promise<void> => {
      await fresh()
      await storage.put({ [`${prefix}${run}`]: { at: now(), input } satisfies Held })
    },
    /** Read and deleted with no other call between them (the object's input gate), so a replayed step finds nothing. */
    take: async (run: string): Promise<unknown> => {
      const key = `${prefix}${run}`
      const held = (await fresh()).get(key) as Held | undefined
      if (!held) return null
      await storage.delete([key])
      return held.input
    },
    drop: async (run?: string): Promise<boolean> => {
      const keys = [...(await storage.list({ prefix: run ? `${prefix}${run}` : prefix })).keys()]
      if (keys.length > 0) await storage.delete(keys)
      return keys.length > 0
    },
  }
}
