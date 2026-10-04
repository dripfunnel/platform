import { idParam, optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadReport, loadReportFilters, reportRanges, reportTabs } from '../../api/reports'
import { ReportsLoading } from '../../features/reports/Reports'
import { ReportsRouteError, ReportsScreen } from '../../features/reports/ReportsScreen'

// The tab and FIRST-RELEASE §10's filters, all in the URL.
const reportsSearch = z.looseObject({
  tab: optionalParam(z.enum(reportTabs)),
  range: optionalParam(z.enum(reportRanges)),
  plan: idParam,
  country: optionalParam(z.string().regex(/^[A-Z]{2}$/)),
})

// The filters' choices come from the API's reports and fail with the page, never silently.
export const Route = createFileRoute('/_app/reports')({
  validateSearch: reportsSearch,
  loaderDeps: ({ search: { tab, range, plan, country } }) => ({ tab, range, plan, country }),
  loader: async ({ deps: { tab, ...filter } }) => {
    const [report, filters] = await Promise.all([loadReport(tab ?? 'growth', filter), loadReportFilters()])
    return { report, filters }
  },
  pendingComponent: ReportsLoading,
  errorComponent: ReportsRouteError,
  component: ReportsScreen,
})
