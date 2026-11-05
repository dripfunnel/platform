import type { FileChange } from '#integrations/sandbox/index'

// Each accepted change, kept in the store's Durable Object's own storage the moment the gate passes it, until its draft
// bundle, preview and design_draft row are written (storefront AI-STUDIO §4 step 6, §7 "A crash"; #1241). Its files are
// what a restarted studio reapplies through the gate when the object stopped before that write.

export type KeptChange = {
  seq: number
  commit: string
  /** The commit's message, the merchant's request or the step's own words. */
  message: string
  userId: string | null
  template: string
  coreVersion: string
  customPaths: string[]
  previewRef: string
  files: FileChange[]
}

type Meta = Omit<KeptChange, 'files'> & { files: number }

/** The parts of a Durable Object's storage this uses. */
export interface KeptStorage {
  list: (options: { prefix: string }) => Promise<Map<string, unknown>>
  put: (entries: Record<string, unknown>) => Promise<void>
  delete: (keys: string[]) => Promise<unknown>
}

/** A storage write takes at most 128 keys. */
const batch = 128
const metaPrefix = 'kept:m:'
const lastKey = 'kept:last'
const filePrefix = (seq: number) => `kept:f:${String(seq).padStart(10, '0')}:`
const metaKey = (seq: number) => `${metaPrefix}${String(seq).padStart(10, '0')}`

export const keptChanges = (storage: KeptStorage) => {
  const metas = async (): Promise<Meta[]> => [...(await storage.list({ prefix: metaPrefix })).values()] as Meta[]
  const putAll = async (entries: [string, unknown][]) => {
    for (let i = 0; i < entries.length; i += batch) await storage.put(Object.fromEntries(entries.slice(i, i + batch)))
  }
  const remove = async (keys: string[]) => {
    for (let i = 0; i < keys.length; i += batch) await storage.delete(keys.slice(i, i + batch))
  }
  // The record first, so a change half removed is never listed.
  const removeOne = async (seq: number) => {
    await storage.delete([metaKey(seq)])
    await remove([...(await storage.list({ prefix: filePrefix(seq) })).keys()])
  }
  return {
    /** Oldest first, each with its files. */
    list: async (): Promise<KeptChange[]> =>
      Promise.all((await metas()).map(async (m) => ({ ...m, files: [...(await storage.list({ prefix: filePrefix(m.seq) })).values()] as FileChange[] }))),
    /** One file to a key, the change's record last, so a change is kept only once all of it is. */
    add: async (change: Omit<KeptChange, 'seq'>): Promise<number> => {
      // Numbered for ever, never reused once dropped, so a save never takes a later change for its own.
      const seq = Number((await storage.list({ prefix: lastKey })).get(lastKey) ?? 0) + 1
      await putAll(change.files.map((f, i) => [`${filePrefix(seq)}${String(i).padStart(5, '0')}`, f]))
      await storage.put({ [metaKey(seq)]: { ...change, seq, files: change.files.length } satisfies Meta, [lastKey]: seq })
      return seq
    },
    /** A change reapplied after a restart is a new commit of the same files. */
    recommit: async (seq: number, commit: string): Promise<void> => {
      const meta = (await metas()).find((m) => m.seq === seq)
      if (meta) await storage.put({ [metaKey(seq)]: { ...meta, commit } })
    },
    /** Every change up to and including `through`, once a save holds them all. */
    drop: async (through: number): Promise<void> => {
      for (const m of (await metas()).filter((m) => m.seq <= through)) await removeOne(m.seq)
    },
    remove: (seq: number): Promise<void> => removeOne(seq),
  }
}

export type KeptChanges = ReturnType<typeof keptChanges>

/** What changed between two themes, as the gate takes it: each file's new text, or null for one removed. */
export const changedFiles = (before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): FileChange[] => [
  ...[...after].filter(([path, content]) => before.get(path) !== content).map(([path, content]) => ({ path, content })),
  ...[...before.keys()].filter((path) => !after.has(path)).map((path) => ({ path, content: null })),
]
