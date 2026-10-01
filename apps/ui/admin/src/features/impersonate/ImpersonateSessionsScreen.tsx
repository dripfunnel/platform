import { useNow } from '@dripfunnel/shared/ui'
import { getRouteApi, Link, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback } from 'react'
import type { SessionFilter } from '../../api/impersonation'
import { withoutCursors } from '../common/activitySearch'
import { useScreenState } from '../common/useScreenState'
import { sessionsStates } from './impersonateHarness'
import { ImpersonateSessions, SessionsError } from './ImpersonateSessions'
import { sessionCallerFor } from './sessionCaller'
import { useSessionActions } from './useSessionActions'
import { useStartSession } from './useStartSession'

const sessionsRoute = getRouteApi('/_app/impersonate_/sessions')
const shellRoute = getRouteApi('/_app')

export const ImpersonateSessionsScreen = () => {
  const page = sessionsRoute.useLoaderData()
  const filter = withoutCursors(sessionsRoute.useSearch())
  const { me, badges } = shellRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const forced = useScreenState(sessionsStates)
  const navigate = sessionsRoute.useNavigate()
  const router = useRouter()
  const now = useNow()
  const caller = sessionCallerFor(me.role, searchStr)
  const reload = useCallback(() => void router.invalidate(), [router])
  const actions = useSessionActions(caller, reload)
  const start = useStartSession(caller, me.name)

  return (
    <>
      <ImpersonateSessions
        page={page}
        filter={filter}
        forced={forced}
        role={caller}
        openCount={badges.openSessions}
        now={now}
        onFilterChange={(next: SessionFilter) => void navigate({ search: next, replace: true })}
        onAction={(action, session) => (action === 'return' ? start.returnTo(session.id) : actions.request(action, session))}
        onRetry={reload}
        pageLink={(cursor, label) => (
          <Link to="/impersonate/sessions" search={{ ...filter, ...cursor }} className="df-button">
            {label}
          </Link>
        )}
      />
      {actions.element}
      {start.element}
    </>
  )
}

export const SessionsRouteError = () => {
  const router = useRouter()
  return <SessionsError onRetry={() => void router.invalidate()} />
}
