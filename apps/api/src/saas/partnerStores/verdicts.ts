import { partnerRoleHas, type PartnerPermission, type PartnerRole } from '#auth/partnerPermissions'
import type { StoreListRow } from '#db/scoped/stores'
import { setupStateOf } from '#saas/provisioning/index'

export type ActionRefusal = 'OWNERS_AND_ADMINS_ONLY' | 'FINANCE_TRIAL_ONLY' | 'BILLING_ROLES_ONLY'
export type ActionPermission = { allowed: true } | { allowed: false; reason: ActionRefusal }
export const storeActions = ['changePlan', 'extendTrial', 'addOverride', 'resendInvite', 'restore', 'suspend', 'retryStep'] as const
export type StoreAction = (typeof storeActions)[number]

// FIRST-RELEASE §6.4 "Offered when", then the permission each needs (ACCESS.md §5.3): an action
// the state does not offer is absent; one the role cannot use is present and refused.
export const storeActionPermission: Record<StoreAction, PartnerPermission> = {
  changePlan: 'stores.plan',
  extendTrial: 'stores.trial',
  addOverride: 'stores.plan',
  resendInvite: 'stores.invite.resend',
  restore: 'stores.suspend',
  suspend: 'stores.suspend',
  retryStep: 'setup.retry',
}

/** Whether the role may take the action, with the code the console shows when it may not. */
export const permissionFor = (action: StoreAction, role: PartnerRole): ActionPermission =>
  partnerRoleHas(role, storeActionPermission[action]) ? { allowed: true } : { allowed: false, reason: action === 'extendTrial' ? 'FINANCE_TRIAL_ONLY' : 'OWNERS_AND_ADMINS_ONLY' }

export const actionsFor = (row: StoreListRow, role: PartnerRole, now: Date): Partial<Record<StoreAction, ActionPermission>> => {
  const setup = setupStateOf(row.job_state && row.job_step && row.job_step_started_at ? { state: row.job_state, step: row.job_step, step_started_at: row.job_step_started_at } : null, now)
  const offered: StoreAction[] = [
    ...(row.status !== 'cancelled' && row.status !== 'closed' ? (['changePlan', 'addOverride'] as const) : []),
    ...(row.status === 'trial' ? (['extendTrial'] as const) : []),
    ...(row.status === 'active' || row.status === 'trial' || row.status === 'past_due' ? (['suspend'] as const) : []),
    ...(row.status === 'suspended' ? (['restore'] as const) : []),
    'resendInvite' as const,
    ...(setup === 'stuck' || setup === 'failed' ? (['retryStep'] as const) : []),
  ]
  return Object.fromEntries(offered.map((action) => [action, permissionFor(action, role)]))
}

