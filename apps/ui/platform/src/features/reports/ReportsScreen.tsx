import { startExport, useExportJob, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { startReportExport, type ReportFilter } from '../../api/reports'
import { reportExportFor, startedExport } from '../../api/exports'
import { harnessEnabled } from '../../harness'
import { formatCountry } from '../../messages'
import { Reports, ReportsError } from './Reports'
import { reportsStates } from './reportsHarness'

const reportsRoute = getRouteApi('/_app/reports')

export const ReportsScreen = () => {
  const { report, filters } = reportsRoute.useLoaderData()
  const { tab, range, plan, country } = reportsRoute.useSearch()
  const forced = useScreenState(reportsStates, harnessEnabled)
  const navigate = reportsRoute.useNavigate()
  const router = useRouter()
  const job = useExportJob()
  const filter: ReportFilter = { range, plan, country }
  return (
    <Reports
      report={report}
      filter={filter}
      plans={filters.plans}
      countries={filters.countries.map((code) => ({ code, name: formatCountry(code) }))}
      forced={forced}
      exportJob={reportExportFor(job, report.tab)}
      onFilter={(next) => void navigate({ search: { ...next, ...(tab ? { tab } : {}) } })}
      onExport={() => void startExport(startedExport('report', startReportExport(report.tab, filter), report.tab))}
      onRetry={() => void router.invalidate()}
    />
  )
}

export const ReportsRouteError = () => {
  const router = useRouter()
  return <ReportsError onRetry={() => void router.invalidate()} />
}
