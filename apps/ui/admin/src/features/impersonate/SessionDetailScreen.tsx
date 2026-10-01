import { useNow } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback } from 'react'
import { messages } from '../../messages'
import { ErrorState } from '../common/ErrorState'
import { LoadingState } from '../common/LoadingState'
import { useScreenState } from '../common/useScreenState'
import { sessionStates } from './impersonateHarness'
import { sessionCallerFor } from './sessionCaller'
import { SessionDetail } from './SessionDetail'
import { useSessionActions } from './useSessionActions'
import { useStartSession } from './useStartSession'

const sessionRoute = getRouteApi('/_app/impersonate_/sessions_/$sessionId')
const shellRoute = getRouteApi('/_app')
const words = messages.impersonate

export const SessionDetailScreen = () => {
  const lookup = sessionRoute.useLoaderData()
  const { sessionId } = sessionRoute.useParams()
  const { me } = shellRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const forced = useScreenState(sessionStates)
  const router = useRouter()
  const now = useNow()
  const caller = sessionCallerFor(me.role, searchStr)
  const reload = useCallback(() => void router.invalidate(), [router])
  const actions = useSessionActions(caller, reload)
  const start = useStartSession(caller, me.name)
  return (
    <>
      <SessionDetail
        id={sessionId}
        lookup={lookup}
        forced={forced}
        role={caller}
        now={now}
        onAction={(action, session) => (action === 'return' ? start.returnTo(session.id) : actions.request(action, session))}
        onRetry={reload}
      />
      {actions.element}
      {start.element}
    </>
  )
}

export const SessionLoading = () => (
  <div className="df-page df-list">
    <LoadingState label={words.session.loading} rows={6} />
  </div>
)

export const SessionRouteError = () => {
  const router = useRouter()
  return (
    <div className="df-page df-list">
      <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: () => void router.invalidate() }} />
    </div>
  )
}
