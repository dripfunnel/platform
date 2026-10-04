import { startExport, useExportJob, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { startReportExport, type ReportFilter } from '../../api/reports'
import { exportKindOf, exportSubjectOf, startedExport } from '../../api/exports'
import { harnessEnabled } from '../../harness'
import { Reports, ReportsError } from './Reports'
import { reportsStates } from './reportsHarness'

const reportsRoute = getRouteApi('/_app/reports')

export const ReportsScreen = () => {
  const { report, plans, countries } = reportsRoute.useLoaderData()
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
      plans={plans}
      countries={countries}
      forced={forced}
      exportJob={exportKindOf(job) === 'report' && exportSubjectOf(job) === report.tab ? job : null}
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
