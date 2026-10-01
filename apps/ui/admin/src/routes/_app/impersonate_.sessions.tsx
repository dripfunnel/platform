import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadSessions } from '../../api/impersonation'
import { loadMe } from '../../api/me'
import { withoutCursors } from '../../features/common/activitySearch'
import { sessionCallerFor } from '../../features/impersonate/sessionCaller'
import { sessionsSearch } from '../../features/impersonate/impersonateSearch'
import { SessionsLoading } from '../../features/impersonate/ImpersonateSessions'
import { ImpersonateSessionsScreen, SessionsRouteError } from '../../features/impersonate/ImpersonateSessionsScreen'

export const Route = createFileRoute('/_app/impersonate_/sessions')({
  validateSearch: z.object(sessionsSearch),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, location }) => {
    const me = await loadMe()
    return loadSessions(withoutCursors(deps), { after: deps.after, before: deps.before }, sessionCallerFor(me.role, location.searchStr))
  },
  pendingComponent: SessionsLoading,
  errorComponent: SessionsRouteError,
  component: ImpersonateSessionsScreen,
})
