import { idParam, optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadPlans } from '../../api/plans'
import { loadReport, reportRanges, reportTabs } from '../../api/reports'
import { loadCreateStoreForm } from '../../api/stores'
import { ReportsLoading } from '../../features/reports/Reports'
import { ReportsRouteError, ReportsScreen } from '../../features/reports/ReportsScreen'

// The tab and FIRST-RELEASE §10's filters, all in the URL.
const reportsSearch = z.looseObject({
  tab: optionalParam(z.enum(reportTabs)),
  range: optionalParam(z.enum(reportRanges)),
  plan: idParam,
  country: optionalParam(z.string().regex(/^[A-Z]{2}$/)),
})

export const Route = createFileRoute('/_app/reports')({
  validateSearch: reportsSearch,
  loaderDeps: ({ search: { tab, range, plan, country } }) => ({ tab, range, plan, country }),
  loader: async ({ deps: { tab, ...filter } }) => {
    // The Plan and Country filters' options: the partner's plans and the countries it sells in.
    const [report, plans, countries] = await Promise.all([
      loadReport(tab ?? 'growth', filter),
      loadPlans().then(
        (page) => page.items.map((plan) => ({ id: plan.id, name: plan.name })),
        () => [],
      ),
      loadCreateStoreForm().then(
        (form) => form.countries.map((country) => ({ code: country.code, name: country.name })),
        () => [],
      ),
    ])
    return { report, plans, countries }
  },
  pendingComponent: ReportsLoading,
  errorComponent: ReportsRouteError,
  component: ReportsScreen,
})
