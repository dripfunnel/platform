import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadDashboard } from '../../api/dashboard'
import { idParam } from '@dripfunnel/shared/search'
import { DashboardRouteError } from '../../features/dashboard/DashboardError'
import { DashboardLoading } from '../../features/dashboard/DashboardLoading'
import { DashboardScreen } from '../../features/dashboard/DashboardScreen'
import { unlessPhone } from '../../features/common/usePhone'

export const Route = createFileRoute('/_app/dashboard')({
  validateSearch: z.object({ partner: idParam }),
  loaderDeps: ({ search }) => ({ partner: search.partner }),
  // A phone shows Find a store instead (phoneView), so it doesn't ask for the Dashboard.
  loader: ({ deps }) => unlessPhone(() => loadDashboard(deps.partner)),
  pendingComponent: DashboardLoading,
  errorComponent: DashboardRouteError,
  component: DashboardScreen,
})
