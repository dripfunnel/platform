import { parseScreenState } from '@dripfunnel/shared/ui'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { dashboardRanges, dashboardVariants, loadDashboard } from '../../api/dashboard'
import { callerFor } from '../../api/me'
import { DashboardLoading } from '../../features/dashboard/DashboardLoading'
import { HomeScreen } from '../../features/onboarding/HomeScreen'
import { harnessEnabled } from '../../harness'

// The checklist until Live, then the Dashboard (FIRST-RELEASE.md §4, §5). `range` is the Dashboard's;
// `view` picks the fixture's variant under the harness; `state`, `setup` and `moment` are the harness's.
export const Route = createFileRoute('/_app/dashboard')({
  validateSearch: z.looseObject({ range: z.string().optional(), view: z.string().optional(), state: z.string().optional(), setup: z.string().optional(), moment: z.string().optional() }),
  loaderDeps: ({ search }) => ({ range: search.range, view: search.view, state: search.state }),
  loader: ({ deps }) =>
    loadDashboard(parseScreenState(deps.range, dashboardRanges) ?? 'month', callerFor('partner-owner', deps.state), (harnessEnabled && parseScreenState(deps.view, dashboardVariants)) || 'northstar'),
  pendingComponent: () => <DashboardLoading product="" />,
  component: HomeScreen,
})
