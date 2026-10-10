// Billing and Choose what to keep are the Owner's (`billing`); a supplier never sees plan or billing state (§19).
export interface BillingSeat {
  canRead: boolean
  /** The plan, the picks and the card are the Owner's own act, never a support session's (src/apis/store/billing.ts). */
  canWrite: boolean
  readOnly: boolean
}

/** The seat from the shell, or the harness's when a state is forced. */
export const billingSeat = (forced: { denied: boolean; readOnly: boolean } | null, acting: { permissions: readonly string[]; seller: unknown }, state: { readOnly: boolean; support: unknown } | null): BillingSeat => {
  if (forced?.denied) return { canRead: false, canWrite: false, readOnly: false }
  if (forced) return { canRead: true, canWrite: !forced.readOnly, readOnly: forced.readOnly }
  return { canRead: acting.seller === null && acting.permissions.includes('billing'), canWrite: !state?.support, readOnly: state?.readOnly ?? false }
}
