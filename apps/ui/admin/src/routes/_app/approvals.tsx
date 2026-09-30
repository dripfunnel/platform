import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadApprovals } from '../../api/approvals'
import { loadMe } from '../../api/me'
import { callerFor } from '../../features/common/harnessCaller'
import { idParam } from '../../features/common/searchParams'
import { ApprovalsLoading } from '../../features/approvals/Approvals'
import { ApprovalsRouteError, ApprovalsScreen } from '../../features/approvals/ApprovalsScreen'

export const Route = createFileRoute('/_app/approvals')({
  validateSearch: z.object({ after: idParam, before: idParam }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps, location }) => {
    const me = await loadMe()
    return loadApprovals(deps, callerFor(me.role, location.searchStr))
  },
  pendingComponent: ApprovalsLoading,
  errorComponent: ApprovalsRouteError,
  component: ApprovalsScreen,
})
