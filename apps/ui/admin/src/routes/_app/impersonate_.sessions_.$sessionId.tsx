import { createFileRoute } from '@tanstack/react-router'
import { loadSession } from '../../api/impersonation'
import { SessionDetailScreen, SessionLoading, SessionRouteError } from '../../features/impersonate/SessionDetailScreen'

export const Route = createFileRoute('/_app/impersonate_/sessions_/$sessionId')({
  loader: ({ params }) => loadSession(params.sessionId),
  pendingComponent: SessionLoading,
  errorComponent: SessionRouteError,
  component: SessionDetailScreen,
})
