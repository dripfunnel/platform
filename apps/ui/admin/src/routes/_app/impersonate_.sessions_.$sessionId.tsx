import { createFileRoute } from '@tanstack/react-router'
import { loadSession } from '../../api/impersonation'
import { sessionCallerFor } from '../../features/impersonate/sessionCaller'
import { SessionDetailScreen, SessionLoading, SessionRouteError } from '../../features/impersonate/SessionDetailScreen'

export const Route = createFileRoute('/_app/impersonate_/sessions_/$sessionId')({
  loader: ({ params, location, context }) => loadSession(params.sessionId, sessionCallerFor(context.me.role, location.searchStr)),
  pendingComponent: SessionLoading,
  errorComponent: SessionRouteError,
  component: SessionDetailScreen,
})
