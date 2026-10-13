import type { StoreChoice } from '../../api/auth'
import type { Acting } from '../../session'

export type Entry = { choice: StoreChoice; acting: Acting; last: boolean }

export type Decision =
  | { kind: 'none' }
  | { kind: 'open'; entry: Entry }
  | { kind: 'choose'; entries: Entry[]; removed: string | null }

const actingOf = (choice: StoreChoice): Acting => ({ storeId: choice.store.id, supplierId: choice.seller?.id ?? null, storeName: choice.store.name })

const same = (a: Acting, b: Acting) => a.storeId === b.storeId && a.supplierId === b.supplierId

// ARCHITECTURE.md §4 step 5 and ACCESS.md §4: no store is refused, one opens directly, several show the chooser with
// the last store first. A last store that is no longer held is why the person is told they were removed from it.
export const decide = (stores: readonly StoreChoice[], last: Acting | null): Decision => {
  const entries = stores.map((choice) => ({ choice, acting: actingOf(choice), last: last !== null && same(actingOf(choice), last) }))
  const [only] = entries
  if (only && entries.length === 1) return { kind: 'open', entry: only }
  if (entries.length === 0) return { kind: 'none' }
  const ordered = [...entries.filter((entry) => entry.last), ...entries.filter((entry) => !entry.last)]
  const removed = last !== null && !entries.some((entry) => entry.last) ? last.storeName : null
  return { kind: 'choose', entries: ordered, removed }
}
