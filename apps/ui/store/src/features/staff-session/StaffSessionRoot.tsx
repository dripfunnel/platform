import { parseScreenState, PortalSessionRoot, staffSessionCopy, type PortalHarnessState } from '@dripfunnel/shared/ui'
import { useRouterState } from '@tanstack/react-router'
import { adminConsoleUrl, harnessEnabled, staffSession } from '../../api/staffSession'
import { formatTime, formatWait, messages } from '../../messages'

// A store sees impersonations only; setup sessions are the partner console's (ACCESS.md §8.2).
export const storeStates = ['impersonating', 'ended', 'expired', 'invalid', 'notice'] as const satisfies readonly PortalHarnessState[]

export const copy = staffSessionCopy(messages.staffSession, { wait: formatWait, time: formatTime })

export const StaffSessionRoot = () => {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const forced = harnessEnabled ? parseScreenState(new URLSearchParams(searchStr).get('state'), storeStates) : null
  return <PortalSessionRoot client={staffSession} copy={copy} adminUrl={adminConsoleUrl} forced={forced} invalid={messages.staffSession.invalid} />
}
