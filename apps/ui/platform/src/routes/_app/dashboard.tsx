import { parseScreenState } from '@dripfunnel/shared/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { dashboardRanges, dashboardVariants, loadDashboard } from '../../api/dashboard'
import { DashboardPending, DashboardRouteError } from '../../features/dashboard/DashboardRouteError'
import { HomeScreen } from '../../features/onboarding/HomeScreen'
import { harnessEnabled } from '../../harness'

// The checklist until Live, then the Dashboard (FIRST-RELEASE.md §4, §5): the numbers load only
// for a Live partner. `range` is the Dashboard's; `view`, `state`, `setup` and `moment` are the harness's.
export const Route = createFileRoute('/_app/dashboard')({
  validateSearch: z.looseObject({ range: z.string().optional(), view: z.string().optional(), state: z.string().optional(), setup: z.string().optional(), moment: z.string().optional() }),
  loaderDeps: ({ search }) => ({ range: search.range, view: search.view }),
  loader: ({ context, deps }) =>
    context.me.partner.state === 'live'
      ? loadDashboard(parseScreenState(deps.range, dashboardRanges) ?? 'month', context.me.role, (harnessEnabled && parseScreenState(deps.view, dashboardVariants)) || 'northstar')
      : Promise.resolve(null),
  pendingComponent: DashboardPending,
  errorComponent: DashboardRouteError,
  component: HomeScreen,
})
