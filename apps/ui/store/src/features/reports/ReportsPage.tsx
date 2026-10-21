import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, EmptyState, ErrorState, ExportJobStatus, LoadingState, useScreenState, type ExportJobWords } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { z } from 'zod'
import { customColumns, customReportSchema, customRows, loadReport, loadReportSuppliers, reportDays, requestReportExport, type CustomReport, type CustomRows, type ReportDays, type ReportPanel, type StoreReport } from '../../api/reports'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { startListExport, useListExport } from '../common/listExport'
import { refusalIn } from '../common/refusal'
import { reportSample, reportStates, samplePlans, type ReportState } from './reportStates'
import { ordersOf, panelsOf, type PanelView, type SuppliersView } from './reportView'
import './reports.css'

const words = messages.reports
const shellRoute = getRouteApi('/_app')
const refused = refusalIn({ ...words.refused, other: words.failed })

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'locked'; plan: string | null } | { kind: 'ready'; report: StoreReport }
type Dialog = { step: 'rows' } | { step: 'columns'; rows: CustomRows }
type Notice = { text: string; plans: boolean }

interface ReportsSeat {
  canRead: boolean
  supplier: boolean
  /** Billing is the Owner's: a Manager is told to ask (FIRST-RELEASE §2, "Locked is never hidden for the Owner"). */
  canUpgrade: boolean
  readOnly: boolean
}

const seatOf = (forced: ReportState | null, acting: { permissions: readonly string[]; seller: unknown }, readOnly: boolean): ReportsSeat => {
  if (forced === 'denied') return { canRead: false, supplier: false, canUpgrade: false, readOnly: false }
  if (forced) return { canRead: true, supplier: false, canUpgrade: forced !== 'lockedManager', readOnly: forced === 'readOnly' }
  const has = (p: string) => acting.permissions.includes(p)
  const supplier = acting.seller !== null
  return { canRead: !supplier && has('reports.read'), supplier, canUpgrade: has('billing'), readOnly }
}

// PLAN_LIMIT names the cheapest plan that unlocks it (src/apis/store/refusals.ts); unchecked data until parsed.
const unlockSchema = z.object({ name: z.string() })
const planOf = (error: unknown): string | null | undefined => {
  if (!isApiError(error, 'PLAN_LIMIT')) return undefined
  const plan = unlockSchema.safeParse(error.details['unlockedBy'])
  return plan.success ? plan.data.name : null
}

const exportWords: ExportJobWords = {
  preparing: words.export.preparing,
  ready: (count, truncated) => (truncated ? fill(words.export.truncated, { count: formatCount(count) }) : fill(plural(words.export.ready, count), { count: formatCount(count) })),
  download: words.export.download,
  file: (date) => fill(words.export.file, { date }),
  expires: (time) => fill(words.export.expires, { time: formatTime(time) }),
  expired: words.export.expired,
  tooLarge: words.export.tooLarge,
  failed: words.export.failed,
}

const customOf = (rows: CustomRows, columns: string): CustomReport | null => {
  const parsed = customReportSchema.safeParse({ rows, columns })
  return parsed.success ? parsed.data : null
}

/** Reports (PortalReports, FIRST-RELEASE §10): 7, 30 or 90 days against the days before, each panel's file, and the builder. */
export const ReportsPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const forced = useScreenState(reportStates, harnessEnabled)
  const sample = useMemo(() => reportSample(forced), [forced])
  const seat = useMemo(() => seatOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const exportJob = useListExport('reports')

  const [days, setDays] = useState<ReportDays>(30)
  const [currency, setCurrency] = useState<string | null>(null)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [suppliers, setSuppliers] = useState<SuppliersView>({ kind: 'loading' })
  const [notice, setNotice] = useState<Notice | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [customPlan, setCustomPlan] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)
  const latestSuppliers = useRef(0)

  // Only the latest request answers: a slow read of the range picked before never replaces the one on screen.
  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (forced === 'locked' || forced === 'lockedManager') return setView({ kind: 'locked', plan: samplePlans.reports })
    if (sample) return setView({ kind: 'ready', report: { ...sample.report, days } })
    if (!seat.canRead) return
    setView({ kind: 'loading' })
    void loadReport(days, currency).then(
      (report) => {
        if (mine === latest.current) setView(report ? { kind: 'ready', report } : { kind: 'error' })
      },
      (error: unknown) => {
        if (mine !== latest.current) return
        const plan = planOf(error)
        setView(plan === undefined ? { kind: 'error' } : { kind: 'locked', plan })
      },
    )
  }, [forced, sample, seat.canRead, days, currency])
  useEffect(load, [load])

  // The supplier panel is a hint beside the rest: a failure leaves it out rather than failing the report.
  const loadSuppliers = useCallback(() => {
    const mine = ++latestSuppliers.current
    if (sample) return setSuppliers(sample.suppliers === 'locked' ? { kind: 'locked', plan: samplePlans.export } : { kind: 'ready', rows: sample.suppliers })
    if (forced || !seat.canRead) return setSuppliers({ kind: 'hidden' })
    // The card leaves until this range's units arrive, so it never shows another range's.
    setSuppliers({ kind: 'loading' })
    void loadReportSuppliers(days, currency).then(
      (rows) => {
        if (mine === latestSuppliers.current) setSuppliers({ kind: 'ready', rows })
      },
      (error: unknown) => {
        if (mine !== latestSuppliers.current) return
        const plan = planOf(error)
        setSuppliers(plan === undefined ? { kind: 'hidden' } : { kind: 'locked', plan })
      },
    )
  }, [forced, sample, seat.canRead, days, currency])
  useEffect(loadSuppliers, [loadSuppliers])

  const planWords = (plan: string | null): Notice => ({ text: fill(seat.canUpgrade ? words.planLimitOwner : words.planLimit, { plan: plan ?? words.locked.somePlan }), plans: seat.canUpgrade })

  /** Starts a panel's file; its refusal is said where it was asked, the page's line or the builder's dialog. */
  const startExport = async (panel: ReportPanel, custom: CustomReport | null, fail: (notice: Notice) => void): Promise<boolean> => {
    const report = view.kind === 'ready' ? view.report : null
    if (!report || sample) return false
    if (report.currency === null) {
      fail({ text: fill(words.nothingToExport, { days: String(days) }), plans: false })
      return false
    }
    setBusy(true)
    try {
      const job = await requestReportExport(panel, days, report.currency, custom)
      void startListExport('reports', Promise.resolve(job))
      return true
    } catch (error) {
      const plan = planOf(error)
      if (plan !== undefined && panel === 'custom') setCustomPlan(plan ?? words.locked.somePlan)
      fail(plan === undefined ? { text: refused(error), plans: false } : planWords(plan))
      return false
    } finally {
      setBusy(false)
    }
  }

  const exportPanel = (panel: ReportPanel) => {
    setNotice(null)
    void startExport(panel, null, setNotice)
  }

  const openDialog = (next: Dialog | null) => {
    setDialogError(null)
    setDialog(next)
  }

  if (!seat.canRead)
    return (
      <div className="df-reports">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState title={words.denied.title} body={seat.supplier ? words.denied.supplier : words.denied.staff} />
      </div>
    )

  if (view.kind === 'locked') return <LockedReports plan={view.plan} canUpgrade={seat.canUpgrade} />

  const report = view.kind === 'ready' ? view.report : null
  const orders = report ? ordersOf(report) : 0
  const panels = report ? panelsOf(report, days, suppliers) : []
  const preparing = exportJob?.state === 'preparing'
  const exportDisabled = busy || preparing || Boolean(sample)

  return (
    <div className="df-reports">
      <div className="df-reports-head">
        <div>
          <h1 className="df-page-title">{words.title}</h1>
          <p className="df-page-lede">{fill(words.rangeLine, { days: String(days), orders: fill(plural(words.orders, orders), { count: formatCount(orders) }) })}</p>
        </div>
        <div className="df-reports-actions">
          <div className="df-reports-range" role="group" aria-label={words.range.label}>
            {reportDays.map((d) => (
              <button key={d} type="button" aria-pressed={days === d} onClick={() => setDays(d)}>
                {fill(words.range.days, { days: String(d) })}
              </button>
            ))}
          </div>
          {report && report.currencies.length > 1 && (
            <label className="df-reports-currency">
              <span className="df-visually-hidden">{words.currency.label}</span>
              <select value={report.currency ?? ''} onChange={(event) => setCurrency(event.target.value)}>
                {report.currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
          )}
          <button type="button" className="df-reports-export" disabled={exportDisabled || !report} onClick={() => exportPanel('takings')}>
            {words.exportAll}
          </button>
        </div>
      </div>
      {seat.readOnly && <p className="df-reports-readonly">{words.readOnly}</p>}
      {exportJob && (
        <p className="df-reports-note" role="status">
          <ExportJobStatus job={exportJob} words={exportWords} />
        </p>
      )}
      {notice && (
        <p className="df-reports-refusal" role="alert">
          {notice.text}{' '}
          {notice.plans && (
            <Link to="/billing" search={(prev) => harnessSearch(prev)}>
              {words.locked.seePlans}
            </Link>
          )}
        </p>
      )}
      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
      {report && (
        <>
          {orders < 3 && (
            <p className="df-reports-thin">
              <strong>{words.thin.title}</strong> {orders > 0 ? words.thin.some : words.thin.none}
            </p>
          )}
          <div className="df-reports-grid">
            {panels.map((panel) => (
              <PanelCard key={panel.key} panel={panel} disabled={exportDisabled || (panel.key === 'suppliers' && suppliers.kind === 'locked')} onExport={() => exportPanel(panel.key)} />
            ))}
            <section className="df-reports-panel" aria-labelledby="df-reports-custom">
              <div className="df-reports-panel-head">
                <h2 id="df-reports-custom">{words.custom.title}</h2>
                <button type="button" className="df-reports-panel-export" disabled={busy || preparing} onClick={() => openDialog({ step: 'rows' })} aria-label={fill(words.exportPanelLabel, { panel: words.custom.title })}>
                  {words.exportPanel}
                </button>
              </div>
              <div className="df-reports-row">
                <span>{words.custom.row}</span>
                <span>{customPlan ?? words.custom.open}</span>
              </div>
              <p className="df-reports-panel-note">{customPlan ? fill(words.custom.lockedNote, { plan: customPlan }) : words.custom.note}</p>
            </section>
          </div>
        </>
      )}
      {dialog?.step === 'rows' && (
        <ConfirmDialog
          key="rows"
          open
          title={words.custom.rowsTitle}
          target={words.custom.rowsTag}
          consequence={words.custom.rowsBody}
          confirmLabel={words.custom.next}
          cancelLabel={words.custom.cancel}
          choices={[{ key: 'rows', label: words.custom.rowsLabel, options: customRows.map((r) => ({ value: r, label: words.custom.rows[r] })), initial: 'orders', error: () => null }]}
          onConfirm={(_, __, picks) => {
            const rows = customRows.find((r) => r === picks['rows'])
            if (rows) openDialog({ step: 'columns', rows })
          }}
          onCancel={() => openDialog(null)}
        />
      )}
      {dialog?.step === 'columns' && (
        <ConfirmDialog
          key="columns"
          open
          title={words.custom.columnsTitle}
          target={words.custom.columnsTag}
          consequence={fill(words.custom.columnsBody, { days: String(days), currency: report?.currency ?? '' })}
          confirmLabel={words.custom.make}
          cancelLabel={words.custom.cancel}
          error={dialogError}
          choices={[
            {
              key: 'columns',
              label: words.custom.columnsLabel,
              options: customColumns[dialog.rows].map((c) => ({ value: c, label: (words.custom.columns[dialog.rows] as Record<string, string>)[c] ?? c })),
              initial: 'basic',
              error: () => null,
            },
          ]}
          onConfirm={(_, __, picks) => {
            const custom = customOf(dialog.rows, picks['columns'] ?? '')
            // The harness's builder shows its two steps and asks the API nothing.
            if (!custom || sample) return openDialog(null)
            setDialogError(null)
            void startExport('custom', custom, (failure) => setDialogError(failure.text)).then((started) => started && openDialog(null))
          }}
          onCancel={() => openDialog(null)}
        />
      )}
    </div>
  )
}

const PanelCard = ({ panel, disabled, onExport }: { panel: PanelView; disabled: boolean; onExport: () => void }) => {
  const id = `df-reports-${panel.key}`
  return (
    <section className="df-reports-panel" aria-labelledby={id}>
      <div className="df-reports-panel-head">
        <h2 id={id}>{panel.title}</h2>
        <button type="button" className="df-reports-panel-export" disabled={disabled} onClick={onExport} aria-label={fill(words.exportPanelLabel, { panel: panel.title })}>
          {words.exportPanel}
        </button>
      </div>
      {panel.big && <span className="df-reports-big">{panel.big}</span>}
      {panel.delta && <span className={`df-reports-delta df-reports-delta--${panel.delta.tone}`}>{panel.delta.text}</span>}
      {panel.rows.length > 0 && (
        <ul className="df-reports-rows">
          {panel.rows.map((row) => (
            <li key={row.key} className="df-reports-row-item">
              <div className="df-reports-row">
                <span>{row.label}</span>
                <span className={row.refund ? 'df-reports-refund' : undefined}>{row.value}</span>
              </div>
              {row.bar !== undefined && (
                <div className="df-reports-bar" aria-hidden="true">
                  <span style={{ width: `${row.bar}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {panel.none && <p className="df-reports-none">{panel.none}</p>}
      <p className="df-reports-panel-note">{panel.note}</p>
    </section>
  )
}

/** Below Growth: the prototype's locked view, naming the plan that unlocks it; a Manager is told to ask the owner. */
const LockedReports = ({ plan, canUpgrade }: { plan: string | null; canUpgrade: boolean }) => {
  const name = plan ?? words.locked.somePlan
  return (
    <div className="df-reports">
      <div>
        <h1 className="df-page-title">{words.title}</h1>
        <p className="df-page-lede">{fill(words.locked.rangeLine, { plan: name })}</p>
      </div>
      <p className="df-reports-thin">
        <strong>{words.thin.title}</strong> {fill(words.locked.body, { plan: name })}
      </p>
      <section className="df-reports-panel" aria-labelledby="df-reports-unlock">
        <div className="df-reports-panel-head">
          <h2 id="df-reports-unlock">{words.locked.title}</h2>
        </div>
        <span className="df-reports-big">{name}</span>
        <span className="df-reports-delta df-reports-delta--muted">{words.locked.delta}</span>
        <p className="df-reports-panel-note">{words.locked.note}</p>
        <div>
          {canUpgrade ? (
            <Link className="df-button df-button--primary" to="/billing" search={(prev) => harnessSearch(prev)}>
              {words.locked.seePlans}
            </Link>
          ) : (
            <p className="df-reports-panel-note">{words.locked.askOwner}</p>
          )}
        </div>
      </section>
    </div>
  )
}
