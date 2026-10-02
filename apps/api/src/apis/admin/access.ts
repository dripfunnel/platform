import type { AccessTarget } from '#auth/assignment'
import { partnerScopedRoles, roleHas } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import type { ActivityPageRequest, ActivityResult } from '#saas/activity/index'
import type { PartnersService } from '#saas/partners/index'
import type { StoresService } from '#saas/stores/index'
import { forbidden, unauthenticated, type AccessPolicy } from '../graphql/scope'

export interface AdminContext extends Record<string, unknown> {
  staff: StaffMember | null
  isAssigned: (staffId: string, target: AccessTarget) => Promise<boolean>
  /** The services in the staff member's scope; built by the composition root per request, null when signed out. */
  activity: (filter: unknown, page: ActivityPageRequest) => Promise<ActivityResult>
  partners: PartnersService | null
  stores: StoresService | null
}

/** ACCESS.md §5.4: the role's permission, then a Partner manager's assignment to the target. */
export const adminPolicy: AccessPolicy<AdminContext> = {
  api: 'admin',
  scopes: ['public', 'session', 'platform'],
  authorize: async (access, { staff, isAssigned }, args) => {
    if (!staff) throw unauthenticated()
    if (access.permission === null) return
    if (!roleHas(staff.role, access.permission)) throw forbidden()
    if (partnerScopedRoles.includes(staff.role) && typeof access.target === 'function') {
      if (!(await isAssigned(staff.id, access.target(args)))) throw forbidden()
    }
  },
}
