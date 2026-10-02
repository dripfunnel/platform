import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadDashboard } from '../../api/dashboard'
import { idParam } from '@dripfunnel/shared/ui'
import { DashboardRouteError } from '../../features/dashboard/DashboardError'
import { DashboardLoading } from '../../features/dashboard/DashboardLoading'
import { DashboardScreen } from '../../features/dashboard/DashboardScreen'

export const Route = createFileRoute('/_app/dashboard')({
  validateSearch: z.object({ partner: idParam }),
  loaderDeps: ({ search }) => ({ partner: search.partner }),
  loader: ({ deps }) => loadDashboard(deps.partner),
  pendingComponent: DashboardLoading,
  errorComponent: DashboardRouteError,
  component: DashboardScreen,
})
