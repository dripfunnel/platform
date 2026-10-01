import { loadTarget } from '../../api/impersonation'
import type { StaffRole } from '../shell/staffRoles'
import { useStartSession } from './useStartSession'

// Impersonate from a partner's Team tab or a store's Users tab: the person is looked up by the
// place they were picked in, so the flow skips "Where should you act?".
export const useImpersonateFrom = (caller: StaffRole, meName: string) => {
  const flow = useStartSession(caller, meName)
  const impersonate = (membershipId: string) =>
    void loadTarget(membershipId, caller)
      .then((target) => target && flow.start({ kind: 'impersonation', target, membershipId }))
      .catch(() => undefined)
  return { start: flow.start, impersonate, element: flow.element }
}
