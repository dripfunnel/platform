import { isApiError } from '@dripfunnel/shared/graphql'
import { csv } from '@dripfunnel/shared/format'
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, reserveTab, Strip, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { changePlan, invoicePdf, loadAllInvoices, loadBilling, loadMoreInvoices, quotePlanChange, type BillingDetails, type BillingInterval, type BillingRead, type CataloguePlan, type PlanChangeQuote, type PlanChangeWhen, type Subscription } from '../../api/billing'
import { harnessEnabled } from '../../harness'
import { fill, formatTime, messages } from '../../messages'
import { downloadCsv } from '../common/download'
import { refusalIn } from '../common/refusal'
import { BillingDetailsDialog } from './BillingDetailsDialog'
import { billingSample, billingStates, type BillingState } from './billingStates'
import { billToLines, cardText, dayOf, invoiceCsvRows, invoiceRow, metersOf, money } from './billingView'
import { PlanGrid } from './PlanGrid'
import './billing.css'

const words = messages.billing
const shellRoute = getRouteApi('/_app')
const refused = refusalIn(words.refused)

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; read: BillingRead }

export interface BillingSeat {
  canRead: boolean
  /** The plan and its card are the Owner's own act, never a support session's (src/apis/store/billing.ts). */
  canWrite: boolean
  readOnly: boolean
}

const seatOf = (forced: BillingState | null, acting: { permissions: readonly string[]; seller: unknown }, state: { readOnly: boolean; support: unknown } | null): BillingSeat => {
  if (forced === 'denied') return { canRead: false, canWrite: false, readOnly: false }
  if (forced) return { canRead: true, canWrite: forced !== 'readOnly', readOnly: forced === 'readOnly' || forced === 'pastDue' }
  return { canRead: acting.seller === null && acting.permissions.includes('billing'), canWrite: !state?.support, readOnly: state?.readOnly ?? false }
}

export type Change = { plan: CataloguePlan; interval: BillingInterval; quotes: Partial<Record<PlanChangeWhen, PlanChangeQuote>> } | { plan: CataloguePlan; interval: BillingInterval; keep: string }

/** Billing (PortalBilling, FIRST-RELEASE §16): the partner's plans, this month's usage, the card, the invoice details and the invoices. */
export const BillingPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const router = useRouter()
  const forced = useScreenState(billingStates, harnessEnabled)
  const sample = useMemo(() => billingSample(forced), [forced])
  const seat = useMemo(() => seatOf(forced, acting, state), [forced, acting, state])

  const [view, setView] = useState<View>({ kind: 'loading' })
  const [period, setPeriod] = useState<BillingInterval | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [change, setChange] = useState<Change | null>(null)
  const [changeError, setChangeError] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)

  // Only the latest read answers, so a slow first read never replaces the one after a change.
  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return setView({ kind: 'ready', read: sample })
    if (!seat.canRead) return
    setView({ kind: 'loading' })
    void loadBilling().then(
      (read) => mine === latest.current && setView({ kind: 'ready', read }),
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, sample, seat.canRead])
  useEffect(load, [load])

  const read = view.kind === 'ready' ? view.read : null
  const sub = read?.subscription ?? null
  const shown = period ?? sub?.interval ?? 'MONTH'

  if (!seat.canRead)
    return (
      <div className="df-billing">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState title={words.denied.title} body={words.denied.body} />
      </div>
    )

  const openChange = (next: Change | null) => {
    setChangeError(null)
    setChange(next)
  }

  /** The quote first: both amounts and the date before anything is charged (SAAS §7.2). */
  const pick = async (plan: CataloguePlan) => {
    if (!sub) return
    setNotice(null)
    if (plan.current && sub.scheduled && sub.interval === shown) return openChange({ plan, interval: shown, keep: sub.scheduled.plan.name })
    if (sample) return openChange({ plan, interval: shown, quotes: sampleQuotes(plan, shown, sub) })
    setPending(plan.id)
    try {
      const quotes: Partial<Record<PlanChangeWhen, PlanChangeQuote>> = {}
      try {
        quotes.NOW = await quotePlanChange(plan.id, shown, 'NOW')
      } catch (error) {
        if (!isApiError(error, 'AT_PERIOD_END_ONLY')) throw error
      }
      if (!quotes.NOW || quotes.NOW.offered.includes('PERIOD_END')) quotes.PERIOD_END = await quotePlanChange(plan.id, shown, 'PERIOD_END')
      openChange({ plan, interval: shown, quotes })
    } catch (error) {
      setNotice(refused(error))
    } finally {
      setPending(null)
    }
  }

  const confirmChange = (when: PlanChangeWhen) => {
    if (!change || !sub) return
    if (sample) return openChange(null)
    setChangeError(null)
    setBusy(true)
    changePlan(change.plan.id, change.interval, when)
      .then(async (after) => {
        openChange(null)
        setToast(changedToast(after, change))
        load()
        await router.invalidate()
      })
      .catch((error: unknown) => setChangeError(refused(error)))
      .finally(() => setBusy(false))
  }

  const savedDetails = (details: BillingDetails) => {
    setEditing(false)
    setToast(words.details.form.saved)
    setView((v) => (v.kind === 'ready' ? { kind: 'ready', read: { ...v.read, details } } : v))
  }

  const canChange = Boolean(seat.canWrite && sub && sub.collectedBy === 'dripfunnel' && !sub.cancelAt && (!seat.readOnly || sub.status === 'past_due'))

  return (
    <div className="df-billing">
      <div className="df-billing-head">
        <div>
          <h1 className="df-page-title">{words.title}</h1>
          {sub && (
            <p className="df-page-lede">
              {fill(words.payLine, { partner: sub.partnerName })} {fill(words.collected[sub.collectedBy], { partner: sub.partnerName })}
            </p>
          )}
        </div>
        {sub && (
          <div className="df-billing-period" role="group" aria-label={words.period.label}>
            {(['MONTH', 'YEAR'] as const).map((i) => (
              <button key={i} type="button" aria-pressed={shown === i} onClick={() => setPeriod(i)}>
                {words.period[i]}
              </button>
            ))}
          </div>
        )}
      </div>
      {seat.readOnly && <p className="df-billing-readonly">{words.readOnly}</p>}
      {sub?.scheduled && (
        <Strip tone="info">
          <strong>{fill(words.banners.scheduled.title, { plan: sub.scheduled.plan.name, date: dayOf(sub.scheduled.at) })}</strong> {words.banners.scheduled.body}
        </Strip>
      )}
      {notice && (
        <p className="df-billing-refusal" role="alert">
          {notice}
        </p>
      )}
      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
      {read && !sub && <EmptyState title={words.noPlan.title} body={words.noPlan.body} />}
      {read && sub && (
        <>
          <PlanGrid plans={read.plans} sub={sub} interval={shown} canChange={canChange} pending={pending} onPick={(plan) => void pick(plan)} />
          <div className="df-billing-two">
            <UsageCard read={read} />
            <div className="df-billing-stack">
              <section className="df-billing-card" aria-labelledby="df-billing-card">
                <h2 id="df-billing-card">{words.card.title}</h2>
                <p className="df-billing-strong">{cardText(sub.card)}</p>
                <p className="df-billing-note">{words.card.note}</p>
              </section>
              <DetailsCard read={read} canEdit={seat.canWrite && !seat.readOnly} onEdit={() => setEditing(true)} />
            </div>
          </div>
          <InvoicesCard read={read} sub={sub} sample={Boolean(sample)} onToast={setToast} />
          {sub.asOf && <p className="df-billing-note">{fill(words.asOf, { time: formatTime(sub.asOf) })}</p>}
        </>
      )}
      {change && sub && (
        <ChangeDialog change={change} sub={sub} busy={busy} error={changeError} onConfirm={confirmChange} onCancel={() => openChange(null)} />
      )}
      {editing && read && <BillingDetailsDialog details={read.details} store={read.store} sample={Boolean(sample)} onSaved={savedDetails} onCancel={() => setEditing(false)} />}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

const changedToast = (after: Subscription, change: Change): string => {
  if ('keep' in change) return fill(words.change.kept, { plan: change.plan.name })
  if (after.scheduled) return fill(words.change.scheduled, { plan: after.scheduled.plan.name, date: dayOf(after.scheduled.at) })
  return fill(words.change.done, { plan: after.plan.name })
}

/** The harness's quote: the dialog's words without asking the API. */
const sampleQuotes = (plan: CataloguePlan, interval: BillingInterval, sub: Subscription): Partial<Record<PlanChangeWhen, PlanChangeQuote>> => {
  const price = (interval === 'YEAR' ? plan.yearly : plan.monthly) ?? sub.price
  const zero = { amount: '0', currency: price.currency }
  return sub.status === 'trial'
    ? { NOW: { offered: ['NOW'], charge: price, credit: zero, today: price, from: new Date().toISOString(), nextPrice: price } }
    : { PERIOD_END: { offered: ['PERIOD_END'], charge: zero, credit: zero, today: zero, from: sub.periodEnd, nextPrice: price } }
}

const ChangeDialog = ({ change, sub, busy, error, onConfirm, onCancel }: { change: Change; sub: Subscription; busy: boolean; error: string | null; onConfirm: (when: PlanChangeWhen) => void; onCancel: () => void }) => {
  const w = words.change
  const per = w.per[change.interval]
  if ('keep' in change)
    return (
      <ConfirmDialog
        open
        title={fill(w.titleKeep, { plan: change.plan.name })}
        target={fill(w.target, { plan: change.plan.name, price: money(sub.price) })}
        consequence={fill(w.keep, { plan: change.plan.name, next: change.keep })}
        confirmLabel={fill(w.confirmKeep, { plan: change.plan.name })}
        cancelLabel={w.cancel}
        blocked={busy ? w.loading : null}
        error={error}
        onConfirm={() => onConfirm('NOW')}
        onCancel={onCancel}
      />
    )
  const ways = (['NOW', 'PERIOD_END'] as const).filter((when) => change.quotes[when])
  const first = ways[0] ?? 'NOW'
  const consequence = (when: PlanChangeWhen) => {
    const q = change.quotes[when]
    if (!q) return ''
    const price = money(q.nextPrice)
    if (when === 'PERIOD_END') return fill(w.later, { from: dayOf(q.from), plan: change.plan.name, price, per })
    if (q.credit.amount === '0' && q.charge.amount === q.today.amount) return fill(w.start, { today: money(q.today), price, per })
    return fill(w.now, { today: money(q.today), charge: money(q.charge), plan: change.plan.name, credit: money(q.credit), current: sub.plan.name, from: dayOf(q.from), price, per })
  }
  const nextPrice = change.quotes[first]?.nextPrice
  const needsCard = !sub.card && nextPrice !== undefined && nextPrice.amount !== '0'
  return (
    <ConfirmDialog
      open
      title={fill(w.title, { plan: change.plan.name })}
      target={fill(w.target, { plan: change.plan.name, price: nextPrice ? `${money(nextPrice)} ${per}` : '' })}
      consequence={(_, picks) => consequence(ways.find((when) => when === picks['when']) ?? first)}
      notes={[w.tax]}
      confirmLabel={fill(w.confirm, { plan: change.plan.name })}
      cancelLabel={w.cancel}
      choices={
        ways.length > 1
          ? [{ key: 'when', label: w.when, options: ways.map((when) => ({ value: when, label: when === 'NOW' ? w.whenNow : w.whenLater })), initial: first, error: () => null }]
          : []
      }
      blocked={needsCard ? w.noCard : busy ? w.loading : null}
      error={error}
      onConfirm={(_, __, picks) => onConfirm(ways.find((when) => when === picks['when']) ?? first)}
      onCancel={onCancel}
    />
  )
}

const UsageCard = ({ read }: { read: BillingRead }) => {
  const meters = metersOf(read.usage, new Date())
  return (
    <section id="df-billing-usage-card" className="df-billing-card" aria-labelledby="df-billing-usage">
      <h2 id="df-billing-usage">{words.usage.title}</h2>
      {meters.length === 0 && <p className="df-billing-note">{words.usage.none}</p>}
      {meters.map((m) => (
        <div key={m.key} className="df-billing-meter">
          <div className="df-billing-meter-row">
            <span>{m.label}</span>
            <span className={`df-billing-meter-value df-billing-meter-value--${m.tone}`}>{m.value}</span>
          </div>
          {m.percent !== null && (
            <div className="df-billing-bar" role="meter" aria-label={m.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={m.percent} aria-valuetext={m.value}>
              <span className={`df-billing-bar-fill df-billing-bar-fill--${m.tone}`} style={{ width: `${m.percent}%` }} />
            </div>
          )}
          {m.note && <span className="df-billing-note">{m.note}</span>}
        </div>
      ))}
    </section>
  )
}

const DetailsCard = ({ read, canEdit, onEdit }: { read: BillingRead; canEdit: boolean; onEdit: () => void }) => {
  const { lines, kind } = billToLines(read.details, read.store)
  return (
    <section className="df-billing-card" aria-labelledby="df-billing-details">
      <div className="df-billing-card-head">
        <h2 id="df-billing-details">{words.details.title}</h2>
        {canEdit && (
          <button type="button" className="df-billing-link" onClick={onEdit} aria-label={words.details.editLabel}>
            {words.details.edit}
          </button>
        )}
      </div>
      {lines.map((line) => (
        <p key={line} className="df-billing-line">
          {line}
        </p>
      ))}
      <p className="df-billing-note">{words.details.notes[kind]}</p>
    </section>
  )
}

const InvoicesCard = ({ read, sub, sample, onToast }: { read: BillingRead; sub: Subscription; sample: boolean; onToast: (text: string) => void }) => {
  const [rows, setRows] = useState(read.invoices.rows)
  const [next, setNext] = useState(read.invoices.next)
  const [busy, setBusy] = useState<'more' | 'export' | null>(null)
  useEffect(() => {
    setRows(read.invoices.rows)
    setNext(read.invoices.next)
  }, [read])

  const more = () => {
    if (!next) return
    setBusy('more')
    loadMoreInvoices(next)
      .then((page) => {
        setRows((r) => [...r, ...page.rows])
        setNext(page.next)
      })
      .catch((error: unknown) => onToast(refused(error)))
      .finally(() => setBusy(null))
  }

  const exportAll = () => {
    if (sample) return downloadCsv(csv(invoiceCsvRows(rows)), words.invoices.file)
    setBusy('export')
    loadAllInvoices()
      .then((all) => downloadCsv(csv(invoiceCsvRows(all)), words.invoices.file))
      .catch((error: unknown) => onToast(refused(error)))
      .finally(() => setBusy(null))
  }

  // The tab opens on the click, before Stripe's fresh link comes back, or the browser blocks it.
  const openPdf = (id: string) => {
    if (sample) return
    const tab = reserveTab()
    if (tab.blocked) return onToast(words.invoices.pdfBlocked)
    invoicePdf(id)
      .then((url) => tab.go(url))
      .catch((error: unknown) => {
        tab.close()
        onToast(refused(error))
      })
  }

  return (
    <section className="df-billing-card df-billing-invoices" aria-labelledby="df-billing-invoices">
      <div className="df-billing-card-head">
        <h2 id="df-billing-invoices">{words.invoices.title}</h2>
        {rows.length > 0 && (
          <button type="button" className="df-billing-link" disabled={busy !== null} onClick={exportAll}>
            {busy === 'export' ? words.invoices.exporting : words.invoices.exportAll}
          </button>
        )}
      </div>
      {rows.length === 0 && <p className="df-billing-note">{sub.status === 'trial' ? words.invoices.noneTrial : words.invoices.none}</p>}
      {rows.length > 0 && (
        <ul className="df-billing-invoice-list">
          {rows.map(invoiceRow).map((row) => (
            <li key={row.id} className="df-billing-invoice">
              <span className="df-billing-invoice-number">{row.number}</span>
              <span className="df-billing-invoice-day">{row.day}</span>
              <span className="df-billing-invoice-label">{row.label}</span>
              <span>{row.amount}</span>
              <span className={`df-billing-invoice-status df-billing-invoice-status--${row.tone}`}>{row.status}</span>
              <button type="button" className="df-billing-link" onClick={() => openPdf(row.id)} aria-label={fill(words.invoices.pdfLabel, { number: row.number })}>
                {words.invoices.pdf}
              </button>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button type="button" className="df-button df-billing-more" disabled={busy !== null} onClick={more}>
          {words.invoices.more}
        </button>
      )}
    </section>
  )
}
