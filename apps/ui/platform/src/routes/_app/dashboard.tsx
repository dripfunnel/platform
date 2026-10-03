import { parseScreenState } from '@dripfunnel/shared/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { dashboardRanges, dashboardVariants, loadDashboard } from '../../api/dashboard'
import { loadOnboarding } from '../../api/onboarding'
import { isPreLive } from '../../api/me'
import { DashboardPending, DashboardRouteError } from '../../features/dashboard/DashboardRouteError'
import { HomeScreen } from '../../features/onboarding/HomeScreen'
import { harnessEnabled } from '../../harness'

// The checklist until Live, then the Dashboard (FIRST-RELEASE.md §4, §5): each loads only in its
// own states. `range` is the Dashboard's; `view`, `state`, `setup` and `moment` are the harness's.
export const Route = createFileRoute('/_app/dashboard')({
  validateSearch: z.looseObject({ range: z.string().optional(), view: z.string().optional(), state: z.string().optional(), setup: z.string().optional(), moment: z.string().optional() }),
  loaderDeps: ({ search }) => ({ range: search.range, view: search.view }),
  loader: async ({ context, deps }) =>
    isPreLive(context.me.partner.state)
      ? { dashboard: null, onboarding: await loadOnboarding() }
      : { dashboard: await loadDashboard(parseScreenState(deps.range, dashboardRanges) ?? 'month', context.me.role, (harnessEnabled && parseScreenState(deps.view, dashboardVariants)) || 'northstar'), onboarding: null },
  pendingComponent: DashboardPending,
  errorComponent: DashboardRouteError,
  component: HomeScreen,
})
