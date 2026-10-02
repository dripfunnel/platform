import type { Store, StoreAction, StorePermission } from '../../api/stores'

export const storesStates = ['loading', 'empty', 'error', 'readonly', 'denied'] as const
export type StoresState = (typeof storesStates)[number]

export const storeStates = ['loading', 'error', 'readonly', 'denied', 'confirm'] as const
export type StoreScreenState = (typeof storeStates)[number]

// ?state=denied shows the API's store as a role without the permissions would get it: every
// action the record offers refused with the role code the API gives that action (ui/README.md §6).
const roleRefusal: Record<StoreAction, StorePermission> = {
  suspend: { allowed: false, reason: 'SUSPENDERS_ONLY' },
  restore: { allowed: false, reason: 'SUPER_ADMIN_ONLY' },
  extendTrial: { allowed: false, reason: 'SUPER_ADMIN_ONLY' },
  resendInvite: { allowed: false, reason: 'INVITERS_ONLY' },
  addNote: { allowed: false, reason: 'NOTERS_ONLY' },
}

export const deniedStore = (store: Store): Store => ({
  ...store,
  actions: Object.fromEntries(Object.keys(store.actions).map((action) => [action, roleRefusal[action as StoreAction]])),
  job: store.job && { ...store.job, actions: { ...(store.job.actions.retry ? { retry: { allowed: false, reason: 'RETRIERS_ONLY' as const } } : {}), ...(store.job.actions.undo ? { undo: { allowed: false, reason: 'CLEANERS_ONLY' as const } } : {}) } },
  impersonate: Object.fromEntries(Object.keys(store.impersonate).map((id) => [id, { allowed: false, reason: 'STAFF_ROLE_NOT_ALLOWED' as const }])),
})
