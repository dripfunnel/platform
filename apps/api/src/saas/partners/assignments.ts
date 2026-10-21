import type { ScopedSql } from '#db/scoped/index'
import { hasLiveAssignment, insertAssignment, removeAssignment, selectStaffForAssignment } from '#db/scoped/assignments'

export type AssignRefusal = 'NOT_FOUND' | 'NOT_A_PARTNER_MANAGER' | 'STAFF_NOT_ACTIVE' | 'ALREADY_ASSIGNED' | 'NOT_ASSIGNED'

/** The staff member as the activity entry names them (LOGGING.md §4). */
export interface Assigned {
  id: string
  label: string
}

export type AssignResult = { ok: true; staff: Assigned } | { ok: false; code: AssignRefusal }

/** ACCESS.md §5.4 (#60): only an active Partner manager is assigned, once per live pair. */
export const assignManager = async (tx: ScopedSql, partnerId: string, staffId: string, by: string, now: Date): Promise<AssignResult> => {
  const staff = await selectStaffForAssignment(tx, staffId)
  if (!staff) return { ok: false, code: 'NOT_FOUND' }
  if (staff.role_key !== 'staff-partner-manager') return { ok: false, code: 'NOT_A_PARTNER_MANAGER' }
  if (staff.status !== 'active') return { ok: false, code: 'STAFF_NOT_ACTIVE' }
  if (await hasLiveAssignment(tx, partnerId, staffId)) return { ok: false, code: 'ALREADY_ASSIGNED' }
  await insertAssignment(tx, partnerId, staffId, by, now)
  return { ok: true, staff: { id: staff.id, label: `${staff.name} <${staff.email}>` } }
}

export const unassignManager = async (tx: ScopedSql, partnerId: string, staffId: string, by: string, now: Date): Promise<AssignResult> => {
  const staff = await selectStaffForAssignment(tx, staffId)
  if (!staff) return { ok: false, code: 'NOT_FOUND' }
  if (!(await removeAssignment(tx, partnerId, staffId, by, now))) return { ok: false, code: 'NOT_ASSIGNED' }
  return { ok: true, staff: { id: staff.id, label: `${staff.name} <${staff.email}>` } }
}
