import { useRef, useState } from 'react'
import { StyleSheet, Text, View } from 'react-native'
import { loadReport, loadReportSuppliers, planOf, reportDays, customRows, type CustomReport, type CustomRows, type ReportDays, type ReportPanel } from '../../api/reports'
import { loadAccess } from '../../api/products'
import { t, type MessageKey } from '../../messages'
import { errorMessage } from '../../messages/errorMessage'
import { tCount } from '../../messages/plural'
import { sessionClient } from '../../session'
import { useTheme } from '../../theme'
import { Button } from '../common/Button'
import { Chip } from '../common/Chip'
import { Notice } from '../common/Notice'
import { useLoad } from '../common/useLoad'
import { loadStateOf } from '../orders/loadState'
import { useFeedback } from '../shell/Feedback'
import { SegmentedControl } from '../shell/SegmentedControl'
import { useShell } from '../shell/ShellData'
import { ShellScreen } from '../states/ShellScreen'
import { Skeleton } from '../states/StateView'
import { reportsAccessOf } from './access'
import { CustomColumnsSheet } from './CustomColumnsSheet'
import { LockedReports } from './LockedReports'
import { PanelCard } from './PanelCard'
import { ReportExportStatus } from './ReportExportStatus'
import { customPanel, ordersOf, panelsOf, type SuppliersView } from './reportView'
import { useReportExport } from './useReportExport'

const defaultDays: ReportDays = 30

// What an export's refusal says: the plan when it names one, else the code's words.
const refusalText = (error: unknown): string => {
  const plan = planOf(error)
  return plan === undefined ? errorMessage(error, 'reports') : t('reports.planLimit', { plan: plan ?? t('reports.locked.somePlan') })
}

// More › Reports (FIRST-RELEASE (store) §10; PortalReports at phone width): 7, 30 or 90 days against the days before as stacked panels, each with its
// Export, and the custom report builder. Owner and Manager; every figure is the API's, and a file opens in the share sheet.
export function ReportsScreen() {
  const client = sessionClient()
  const feedback = useFeedback()
  const { colors } = useTheme()
  const { state, online } = useShell()
  const [days, setDays] = useState<ReportDays>(defaultDays)
  const [currency, setCurrency] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [builderRows, setBuilderRows] = useState<CustomRows | null>(null)
  const [customPlan, setCustomPlan] = useState<string | null>(null)
  const currencies = useRef<string[]>([])

  const permissions = useLoad(() => loadAccess(client), [client])
  const access = permissions.state.status === 'ready' ? reportsAccessOf(permissions.state.data, state?.readOnly === true) : null
  const canRead = access?.canRead === true
  const report = useLoad(() => (canRead ? loadReport(client, days, currency) : Promise.resolve(null)), [client, canRead, days, currency])
  const suppliers = useLoad<SuppliersView>(
    () =>
      canRead
        ? loadReportSuppliers(client, days, currency).then(
            (rows): SuppliersView => ({ kind: 'ready', rows }),
            (error: unknown): SuppliersView => {
              const plan = planOf(error)
              return plan === undefined ? { kind: 'hidden' } : { kind: 'locked', plan }
            },
          )
        : Promise.resolve({ kind: 'hidden' }),
    [client, canRead, days, currency],
  )
  const exported = useReportExport(client)

  const failure = permissions.state.status === 'error' ? permissions.state.error : report.state.status === 'error' && planOf(report.state.error) === undefined ? report.state.error : null
  if (failure !== null) {
    return (
      <ShellScreen
        label={t('more.reports')}
        state={loadStateOf(failure, online)}
        onRetry={() => {
          permissions.reload()
          report.reload()
        }}
      >
        {null}
      </ShellScreen>
    )
  }
  if (access !== null && !access.canRead) {
    return (
      <ShellScreen label={t('more.reports')} state="denied">
        {null}
      </ShellScreen>
    )
  }
  if (report.state.status === 'error') {
    return (
      <ShellScreen label={t('more.reports')}>
        <LockedReports plan={planOf(report.state.error) ?? null} canAsk={access?.canAskPlan === true} />
      </ShellScreen>
    )
  }

  const data = report.state.status === 'ready' ? report.state.data : null
  if (report.state.status === 'ready' && data === null) {
    return (
      <ShellScreen label={t('more.reports')} state="notFound">
        {null}
      </ShellScreen>
    )
  }
  if (data !== null && data.currencies.length > 0) currencies.current = data.currencies
  const shownCurrency = currency ?? data?.currency ?? null
  const orders = data ? ordersOf(data) : 0
  const exportDisabled = exported.busy || data === null

  const exportPanel = async (panel: ReportPanel) => {
    setNotice(null)
    if (data === null) return
    if (data.currency === null) {
      setNotice(t('reports.nothingToExport', { days }))
      return
    }
    try {
      await exported.begin(panel, days, data.currency, null)
    } catch (error) {
      setNotice(refusalText(error))
    }
  }

  const openBuilder = () => {
    setNotice(null)
    if (data?.currency === null) {
      setNotice(t('reports.nothingToExport', { days }))
      return
    }
    feedback.sheet({
      tag: t('reports.custom.rowsTag'),
      title: t('reports.custom.rowsTitle'),
      body: t('reports.custom.rowsBody'),
      choices: customRows.map((rows) => ({ value: rows, label: t(`reports.custom.rows.${rows}` as MessageKey) })),
      confirm: t('reports.custom.next'),
      onConfirm: ({ choice }) => setBuilderRows(customRows.find((rows) => rows === choice) ?? null),
    })
  }

  const makeCustom = async (custom: CustomReport) => {
    if (data?.currency == null) return
    try {
      await exported.begin('custom', days, data.currency, custom)
    } catch (error) {
      const plan = planOf(error)
      if (plan !== undefined) setCustomPlan(plan ?? t('reports.locked.somePlan'))
      throw error
    }
  }

  const panels = data ? panelsOf(data, days, suppliers.state.status === 'ready' ? suppliers.state.data : { kind: 'loading' }) : []
  return (
    <ShellScreen label={t('more.reports')}>
      <SegmentedControl
        segments={reportDays.map((value) => ({ key: String(value), label: t('reports.range.days', { days: value }) }))}
        value={String(days)}
        onChange={(key) => setDays(reportDays.find((value) => String(value) === key) ?? defaultDays)}
      />
      <View style={styles.content}>
        <View style={styles.head}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.heading }]}>
            {t('reports.title')}
          </Text>
          <Text style={[styles.sub, { color: colors.muted }]}>{t('reports.rangeLine', { days, orders: tCount('reports.orders', orders) })}</Text>
        </View>

        {currencies.current.length > 1 ? (
          <View accessibilityLabel={t('reports.currency.label')} style={styles.chips}>
            {currencies.current.map((code) => (
              <Chip key={code} label={code} selected={code === shownCurrency} onPress={() => setCurrency(code)} />
            ))}
          </View>
        ) : null}

        <Button kind="secondary" label={t('reports.exportAll')} busy={exported.busy} disabled={exportDisabled} onPress={() => void exportPanel('takings')} />
        {access?.readOnly ? <Notice text={t('reports.readOnly')} /> : null}
        {notice !== null ? <Notice kind="error" text={notice} /> : null}
        {exported.error !== null ? <Notice kind="error" text={errorMessage(exported.error, 'reports')} /> : null}
        {exported.job ? <ReportExportStatus job={exported.job} onShare={() => void exported.share(exported.job as NonNullable<typeof exported.job>)} /> : null}

        {data === null ? <Skeleton /> : null}
        {data !== null && orders < 3 ? <Notice text={`${t('reports.thin.title')} ${orders > 0 ? t('reports.thin.some') : t('reports.thin.none')}`} /> : null}
        {data !== null
          ? panels.map((panel) => <PanelCard key={panel.key} panel={panel} disabled={exportDisabled || (panel.key === 'suppliers' && suppliers.state.status === 'ready' && suppliers.state.data.kind === 'locked')} onExport={() => void exportPanel(panel.key)} />)
          : null}
        {data !== null ? <PanelCard panel={customPanel(customPlan)} disabled={exportDisabled} onExport={openBuilder} /> : null}
      </View>
      {builderRows !== null && data?.currency ? (
        <CustomColumnsSheet rows={builderRows} days={days} currency={data.currency} onClose={() => setBuilderRows(null)} onMake={makeCustom} />
      ) : null}
    </ShellScreen>
  )
}

const styles = StyleSheet.create({
  content: { padding: 14, paddingBottom: 32, gap: 14 },
  head: { gap: 2 },
  title: { fontSize: 22, fontWeight: '800' },
  sub: { fontSize: 13, lineHeight: 19 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
})
