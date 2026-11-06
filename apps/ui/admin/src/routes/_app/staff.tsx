import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadStaff } from '../../api/staff'
import { callerFor } from '../../features/common/harnessCaller'
import { cursorParam } from '../../features/common/cursorParam'
import { StaffLoading } from '../../features/staff/Staff'
import { StaffRouteError, StaffScreen } from '../../features/staff/StaffScreen'

export const Route = createFileRoute('/_app/staff')({
  validateSearch: z.object({ after: cursorParam, before: cursorParam }),
  loaderDeps: ({ search }) => search,
  loader: ({ deps, location, context }) => loadStaff(deps, callerFor(context.me.role, location.searchStr)),
  pendingComponent: StaffLoading,
  errorComponent: StaffRouteError,
  component: StaffScreen,
})
