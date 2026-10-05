// The acting store and supplier the portal names on every request (ACCESS.md §4). Remembered on
// this device as a convenience only: the server checks it against the session's memberships.

export interface Acting {
  storeId: string
  supplierId: string | null
}

const key = 'df-store-acting'

let current: Acting | null = null

const read = (): Acting | null => {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    if (typeof value !== 'object' || value === null || !('storeId' in value) || typeof value.storeId !== 'string') return null
    const supplierId = 'supplierId' in value && typeof value.supplierId === 'string' ? value.supplierId : null
    return { storeId: value.storeId, supplierId }
  } catch {
    return null
  }
}

export const actingStore = (): Acting | null => (current ??= read())

export const rememberActing = (acting: Acting | null): void => {
  current = acting
  try {
    if (acting) localStorage.setItem(key, JSON.stringify(acting))
    else localStorage.removeItem(key)
  } catch {
    // A private window without storage still works for this visit.
  }
}

/** The headers the Store API reads the acting store from (apps/api src/auth/storeCaller.ts). */
export const actingHeaders = (): Record<string, string> => {
  const acting = actingStore()
  if (!acting) return {}
  return acting.supplierId ? { 'x-store': acting.storeId, 'x-supplier': acting.supplierId } : { 'x-store': acting.storeId }
}
