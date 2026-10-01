import { useRouterState } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { returnToSession, type StaffSession } from '../../api/impersonation'
import { fill, messages } from '../../messages'
import { harnessEnabled } from '../../harness'
import { Toast } from '../common/Toast'
import type { StaffRole } from '../shell/staffRoles'
import { simulatedReauth } from './impersonateHarness'
import { reservePortalTab } from './openPortal'
import { refusalText } from './sessionText'
import { sessionsChanged } from './sessionEvents'
import { StartSessionDialog } from './StartSessionDialog'
import type { StartSubject } from './startFlow'

const toasts = messages.impersonate.toasts

// One start flow for Impersonate, a partner's Team tab, a store's Users tab and a partner's
// setup entry, so each says and checks the same things.
export const useStartSession = (caller: StaffRole, meName: string) => {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const [subject, setSubject] = useState<StartSubject | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const simulate = harnessEnabled ? simulatedReauth(new URLSearchParams(searchStr).get('state')) : null

  const onStarted = (session: StaffSession, tabBlocked: boolean) => {
    if (tabBlocked) return setToast(toasts.popupBlocked)
    setToast(session.kind === 'setup' ? fill(toasts.startedSetup, { partner: session.partner.name }) : fill(toasts.started, { name: session.target?.name ?? '' }))
  }

  // Opens the session's tab again with a fresh link; the tab is reserved on the click.
  const returnTo = (sessionId: string) => {
    const tab = reservePortalTab()
    returnToSession(sessionId, caller)
      .then((result) => {
        if (!result.ok) {
          tab.close()
          sessionsChanged()
          return setToast(refusalText(result.reason))
        }
        tab.go(result.handoff)
        if (tab.blocked) setToast(toasts.popupBlocked)
      })
      .catch(() => {
        tab.close()
        setToast(toasts.failed)
      })
  }

  const element = (
    <>
      <StartSessionDialog subject={subject} caller={caller} meName={meName} simulate={simulate} onClose={() => setSubject(null)} onStarted={onStarted} />
      <Toast message={toast} onDone={clearToast} />
    </>
  )

  return { start: setSubject, returnTo, element }
}
