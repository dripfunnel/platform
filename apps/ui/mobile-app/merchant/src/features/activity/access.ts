// Who may read the store's activity log (LOGGING.md §6; ACCESS.md §5.1): `activity.read` is the Owner's and the Manager's. A store past due still
// reads. The server decides every call again.
export type ActivityAccess = { canRead: boolean }

export const activityAccessOf = (acting: { permissions: readonly string[]; supplier: boolean }): ActivityAccess => ({ canRead: !acting.supplier && acting.permissions.includes('activity.read') })
