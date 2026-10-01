// Who may start which staff session (ACCESS.md §8.1, §8.2), shared by the sample servers so the
// Team tab, the Users tab and Impersonate give the same answer the API will.
import type { StaffRole } from '../features/shell/staffRoles'
import type { SessionPermission, TargetStatus } from './impersonation'

export const impersonators: readonly StaffRole[] = ['staff-super-admin', 'staff-support']
export const setupStarters: readonly StaffRole[] = ['staff-super-admin', 'staff-partner-manager']

export const impersonatePermission = (caller: StaffRole, status: TargetStatus, partnerClosed: boolean): SessionPermission => {
  if (!impersonators.includes(caller)) return { allowed: false, reason: 'STAFF_ROLE_NOT_ALLOWED' }
  if (partnerClosed) return { allowed: false, reason: 'PARTNER_CLOSED' }
  if (status !== 'active') return { allowed: false, reason: 'TARGET_NOT_ACTIVE' }
  return { allowed: true }
}
