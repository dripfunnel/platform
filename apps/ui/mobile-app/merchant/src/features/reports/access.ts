// Who may open Reports (FIRST-RELEASE (store) §10; ACCESS.md §5.1): `reports.read` is the Owner's and the Manager's, never Staff's or a supplier's.
// The server decides every call again; Billing is the Owner's, so a seat without it is told to ask.
export type ReportsAccess = { canRead: boolean; canAskPlan: boolean; readOnly: boolean }

export const reportsAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }, readOnly: boolean): ReportsAccess => {
  const has = (permission: string) => !acting.supplier && acting.permissions.includes(permission)
  return { canRead: has('reports.read'), canAskPlan: !has('billing'), readOnly }
}
