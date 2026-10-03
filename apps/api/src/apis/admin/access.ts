import type { AccessTarget } from '#auth/assignment'
import { isStaffPermission, partnerScopedRoles, roleHas, staffPermissions } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import type { ActivityPageRequest, ActivityResult } from '#saas/activity/index'
import type { PartnersService } from '#saas/partners/index'
import type { DashboardService } from '#saas/dashboard/index'
import type { StoresService } from '#saas/stores/index'
import type { StaffSessionsService } from '#saas/staffSessions/index'
import { forbidden, unauthenticated, type AccessPolicy } from '../graphql/scope'

export interface AdminContext extends Record<string, unknown> {
  staff: StaffMember | null
  isAssigned: (staffId: string, target: AccessTarget) => Promise<boolean>
  /** The services in the staff member's scope; built by the composition root per request, null when signed out. */
  activity: (filter: unknown, page: ActivityPageRequest) => Promise<ActivityResult>
  partners: PartnersService | null
  stores: StoresService | null
  staffSessions: StaffSessionsService | null
  dashboard: DashboardService | null
}

/** ACCESS.md §5.4: the role's permission, then a Partner manager's assignment to the target. */
export const adminPolicy: AccessPolicy<AdminContext> = {
  api: 'admin',
  scopes: ['public', 'session', 'platform'],
  permissions: staffPermissions,
  authorize: async (access, { staff, isAssigned }, args) => {
    if (!staff) throw unauthenticated()
    if (access.permission === null) return
    if (!isStaffPermission(access.permission) || !roleHas(staff.role, access.permission)) throw forbidden()
    if (partnerScopedRoles.includes(staff.role) && typeof access.target === 'function') {
      if (!(await isAssigned(staff.id, access.target(args)))) throw forbidden()
    }
  },
}
