import { loadTarget, type TargetPlace } from '../../api/impersonation'
import { messages } from '../../messages'
import type { StaffRole } from '../shell/staffRoles'
import { useStartSession } from './useStartSession'

// Impersonate from a partner's Team tab or a store's Users tab: the person is looked up by the
// place they were picked in, so the flow skips "Where should you act?".
export const useImpersonateFrom = (caller: StaffRole, meName: string) => {
  const flow = useStartSession(caller, meName)
  const impersonate = (membershipId: string, place: TargetPlace) =>
    void loadTarget(membershipId, place)
      .then((target) => (target ? flow.start({ kind: 'impersonation', target, membershipId }) : flow.say(messages.impersonate.toasts.targetNotFound)))
      .catch(() => flow.say(messages.impersonate.toasts.failed))
  return { start: flow.start, impersonate, element: flow.element }
}
