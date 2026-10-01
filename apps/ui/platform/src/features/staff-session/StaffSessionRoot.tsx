import { parseScreenState, portalHarnessStates, PortalSessionRoot, staffSessionCopy } from '@dripfunnel/shared/ui'
import { useRouterState } from '@tanstack/react-router'
import { adminConsoleUrl, staffSession } from '../../api/staffSession'
import { harnessEnabled } from '../../harness'
import { formatTime, formatWait, messages } from '../../messages'

export const copy = staffSessionCopy(messages.staffSession, { wait: formatWait, time: formatTime })

export const StaffSessionRoot = () => {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const forced = harnessEnabled ? parseScreenState(new URLSearchParams(searchStr).get('state'), portalHarnessStates) : null
  return <PortalSessionRoot client={staffSession} copy={copy} adminUrl={adminConsoleUrl} forced={forced} invalid={messages.staffSession.invalid} />
}
