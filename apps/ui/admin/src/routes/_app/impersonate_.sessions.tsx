import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadSessions } from '../../api/impersonation'
import { withoutCursors } from '../../features/common/activitySearch'
import { sessionsSearch } from '../../features/impersonate/impersonateSearch'
import { SessionsLoading } from '../../features/impersonate/ImpersonateSessions'
import { ImpersonateSessionsScreen, SessionsRouteError } from '../../features/impersonate/ImpersonateSessionsScreen'

export const Route = createFileRoute('/_app/impersonate_/sessions')({
  validateSearch: z.object(sessionsSearch),
  loaderDeps: ({ search }) => search,
  loader: ({ deps }) => loadSessions(withoutCursors(deps), { after: deps.after, before: deps.before }),
  pendingComponent: SessionsLoading,
  errorComponent: SessionsRouteError,
  component: ImpersonateSessionsScreen,
})
