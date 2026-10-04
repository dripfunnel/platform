import { ActionControl, DetailTabs, ErrorState, ExportJobStatus, FilterSelect, InfoNote, ListHeader, LoadingState, type ExportJobWords } from '@dripfunnel/shared/ui'
import type { ExportJob } from '@dripfunnel/shared/graphql'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/detail.css'
import { Link } from '@tanstack/react-router'
import { reportRanges, reportTabs, type Report, type ReportFilter, type ReportTab } from '../../api/reports'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { GrowthTab, PlansTab, RevenueTab, SetupTab, StoresTab, UsageTab } from './ReportTabs'
import type { ReportsState } from './reportsHarness'
import './reports.css'

const words = messages.reports
const screen = messages.screens.reports

const jobWordsFor = (tab: ReportTab): ExportJobWords => ({
  preparing: words.export.preparing,
  ready: (count, truncated) => fill(plural(truncated ? words.export.truncated : words.export.ready, count), { count: formatCount(count) }),
  download: words.export.download,
  file: (date) => fill(words.export.file, { tab, date }),
  expires: (time) => fill(words.export.expires, { time: formatTime(time) }),
  expired: words.export.expired,
  tooLarge: words.export.failed,
  failed: words.export.failed,
})

const Header = ({ action }: { action?: React.ReactNode }) => <ListHeader title={screen.title} sub={screen.lede} action={action} />

export const ReportsLoading = () => (
  <div className="df-page df-list">
    <Header />
    <LoadingState label={words.loading} rows={6} />
  </div>
)

export const ReportsError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="df-page df-list">
    <Header />
    <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry }} />
  </div>
)

const isFresh = (report: Report): boolean => ('fresh' in report.data ? report.data.fresh : false)

export interface ReportsProps {
  report: Report
  filter: ReportFilter
  plans: readonly { id: string; name: string }[]
  countries: readonly { code: string; name: string }[]
  forced: ReportsState | null
  exportJob: ExportJob | null
  onFilter: (filter: ReportFilter) => void
  onExport: () => void
  onRetry: () => void
}

// Six tabs of the API's totals (§10): a summary sentence, bars and a table each, never an order,
// customer or product.
export const Reports = ({ report, filter, plans, countries, forced, exportJob, onFilter, onExport, onRetry }: ReportsProps) => {
  if (forced === 'loading') return <ReportsLoading />
  if (forced === 'error') return <ReportsError onRetry={onRetry} />
  const tab: ReportTab = report.tab
  return (
    <div className="df-page df-list df-reports">
      <Header
        action={
          <div className="df-report-export">
            <ActionControl label={words.export.button} refusal={null} disabled={exportJob?.state === 'preparing'} onRun={onExport} />
            <p className="df-report-export-status" role="status">
              {exportJob && <ExportJobStatus job={exportJob} words={jobWordsFor(tab)} />}
            </p>
          </div>
        }
      />
      <DetailTabs
        label={words.tabsLabel}
        tabs={reportTabs}
        labels={words.tabs}
        current={tab}
        link={(target, props) => <Link to="/reports" search={{ ...filter, ...(target === 'growth' ? {} : { tab: target }) }} {...props} />}
      />
      <div className="df-list-filters" role="group" aria-label={words.filters.label}>
        <FilterSelect label={words.filters.range} anyLabel={words.filters.ranges['6m']} options={reportRanges.filter((r) => r !== '6m').map((r) => ({ value: r, label: words.filters.ranges[r] }))} value={filter.range === '3m' ? '3m' : undefined} onChange={(value) => onFilter({ ...filter, range: value })} />
        {plans.length > 0 && <FilterSelect label={words.filters.plan} anyLabel={words.filters.anyPlan} options={plans.map((plan) => ({ value: plan.id, label: plan.name }))} value={filter.plan} onChange={(value) => onFilter({ ...filter, plan: value })} />}
        {countries.length > 0 && <FilterSelect label={words.filters.country} anyLabel={words.filters.anyCountry} options={countries.map((country) => ({ value: country.code, label: country.name }))} value={filter.country} onChange={(value) => onFilter({ ...filter, country: value })} />}
      </div>
      {(forced === 'fresh' || isFresh(report)) && <InfoNote>{words.fresh}</InfoNote>}
      {report.tab === 'growth' && <GrowthTab data={report.data} />}
      {report.tab === 'revenue' && <RevenueTab data={report.data} />}
      {report.tab === 'plans' && <PlansTab data={report.data} />}
      {report.tab === 'stores' && <StoresTab data={report.data} />}
      {report.tab === 'usage' && <UsageTab data={report.data} />}
      {report.tab === 'setup' && <SetupTab data={report.data} />}
    </div>
  )
}
