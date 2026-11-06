import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadApprovals } from '../../api/approvals'
import { callerFor } from '../../features/common/harnessCaller'
import { cursorParam } from '../../features/common/cursorParam'
import { ApprovalsLoading } from '../../features/approvals/Approvals'
import { ApprovalsRouteError, ApprovalsScreen } from '../../features/approvals/ApprovalsScreen'

export const Route = createFileRoute('/_app/approvals')({
  validateSearch: z.object({ after: cursorParam, before: cursorParam }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps, location, context }) => loadApprovals(deps, callerFor(context.me.role, location.searchStr)),
  pendingComponent: ApprovalsLoading,
  errorComponent: ApprovalsRouteError,
  component: ApprovalsScreen,
})
