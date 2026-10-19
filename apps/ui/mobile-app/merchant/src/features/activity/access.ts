// Who may read and export the store's activity log (LOGGING.md §6; ACCESS.md §5.1): `activity.read` is the Owner's and the Manager's, and
// `activity.export` the Owner's alone. A store past due still reads and exports. The server decides every call again.
export type ActivityAccess = { canRead: boolean; canExport: boolean }

export const activityAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }): ActivityAccess => {
  const has = (permission: string) => !acting.supplier && acting.permissions.includes(permission)
  return { canRead: has('activity.read'), canExport: has('activity.export') }
}
