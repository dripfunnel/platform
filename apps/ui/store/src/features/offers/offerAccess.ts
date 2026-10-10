import type { OfferState } from './offerStates'

// What the acting seat may do with offers (ACCESS §5.1, OFFERS-DESIGN §4): Owner and Manager change them, Staff read
// them, a supplier has no Offers at all. The API decides every read and write again; this only shapes the screen.

export interface OfferAccess {
  canRead: boolean
  canEdit: boolean
  /** Reads without changing: Staff, told so (§4). */
  viewOnly: boolean
  /** The store is past due and view-only (§7). */
  readOnly: boolean
  /** A run of single-use codes as a file: Owner and Manager, not Staff (ACCESS §5.1). */
  canExport: boolean
  /** Billing is the Owner's: a Manager is told to ask (U2). */
  canUpgrade: boolean
}

const none: OfferAccess = { canRead: false, canEdit: false, viewOnly: false, readOnly: false, canExport: false, canUpgrade: false }

export const offerAccessOf = (forced: OfferState | null, acting: { permissions: readonly string[] }, readOnly: boolean): OfferAccess => {
  if (forced === 'denied') return none
  if (forced === 'staff') return { ...none, canRead: true, viewOnly: true }
  if (forced === 'readOnly') return { ...none, canRead: true, readOnly: true, canExport: true, canUpgrade: true }
  if (forced) return { canRead: true, canEdit: true, viewOnly: false, readOnly: false, canExport: true, canUpgrade: true }
  const has = (p: string) => acting.permissions.includes(p)
  const writes = has('offers.write')
  return { canRead: has('offers.read'), canEdit: writes && !readOnly, viewOnly: has('offers.read') && !writes, readOnly, canExport: has('offers.export'), canUpgrade: has('billing') }
}
