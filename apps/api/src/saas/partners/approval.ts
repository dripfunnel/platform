import type { StaffRole } from '#auth/staff'
import type { SetupSessionRow } from '#db/scoped/partners'

// ui/admin/FIRST-RELEASE.md §4.3, decided 2026-09-30: two staff must be involved in an
// approval, except that a Super admin counts for both.
export type ApproverRule = 'alone' | 'second' | 'two'

export interface ApprovalRule {
  /** The staff member who ran the latest setup session since the submission, if any. */
  setUpBy: { id: string; name: string; role: StaffRole } | null
  rule: ApproverRule
}

export const approvalRuleFor = (sessions: readonly SetupSessionRow[], submittedAt: Date | null): ApprovalRule => {
  // Sessions started before the submission are what set the partner up; a session opened
  // afterwards (to help with a send-back) counts as well, since the setter still knows it best.
  const setup = sessions.find((s) => submittedAt === null || s.started_at <= submittedAt) ?? sessions[0] ?? null
  if (!setup) return { setUpBy: null, rule: 'two' }
  const setUpBy = { id: setup.staff_user_id, name: setup.staff_name, role: setup.staff_role as StaffRole }
  return { setUpBy, rule: setUpBy.role === 'staff-super-admin' ? 'alone' : 'second' }
}

export type ApprovalVerdict = 'approve' | 'SET_UP_BY_CALLER' | 'ALREADY_APPROVED_BY_CALLER' | 'needs_second'

/**
 * What this approval does: completes it, records the first of two, or is refused. The setter
 * never approves alone unless they are a Super admin, and nobody approves twice.
 */
export const approvalVerdict = (
  rule: ApprovalRule,
  caller: { id: string; role: StaffRole },
  priorApprovers: readonly string[],
): ApprovalVerdict => {
  if (priorApprovers.includes(caller.id)) return 'ALREADY_APPROVED_BY_CALLER'
  if (rule.rule === 'alone') return caller.id === rule.setUpBy?.id || caller.role === 'staff-super-admin' ? 'approve' : priorApprovers.length >= 1 ? 'approve' : 'needs_second'
  if (rule.setUpBy && caller.id === rule.setUpBy.id && caller.role !== 'staff-super-admin') return 'SET_UP_BY_CALLER'
  // A Super admin counts for both (§4.3), so one is enough on either rule.
  if (caller.role === 'staff-super-admin') return 'approve'
  return priorApprovers.length >= 1 ? 'approve' : 'needs_second'
}
