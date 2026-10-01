import { createFileRoute } from '@tanstack/react-router'
import { loadSession } from '../../api/impersonation'
import { loadMe } from '../../api/me'
import { sessionCallerFor } from '../../features/impersonate/sessionCaller'
import { SessionDetailScreen, SessionLoading, SessionRouteError } from '../../features/impersonate/SessionDetailScreen'

export const Route = createFileRoute('/_app/impersonate_/sessions_/$sessionId')({
  loader: async ({ params, location }) => {
    const me = await loadMe()
    return loadSession(params.sessionId, sessionCallerFor(me.role, location.searchStr))
  },
  pendingComponent: SessionLoading,
  errorComponent: SessionRouteError,
  component: SessionDetailScreen,
})
