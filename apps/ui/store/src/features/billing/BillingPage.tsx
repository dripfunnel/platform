import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog, EmptyState, ErrorState, LoadingState, Strip, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { changePlan, loadBilling, quotePlanChange, type BillingInterval, type BillingRead, type CataloguePlan, type PlanChangeQuote, type PlanChangeWhen, type Subscription } from '../../api/billing'
import { harnessEnabled } from '../../harness'
import { fill, formatTime, messages } from '../../messages'
import { refusalIn } from '../common/refusal'
import { billingSample, billingStates, type BillingState } from './billingStates'
import { cardText, dayOf, metersOf, money } from './billingView'
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

/** Billing (PortalBilling, FIRST-RELEASE §16): the partner's plans, this month's usage and the card. */
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
            </div>
          </div>
          {sub.asOf && <p className="df-billing-note">{fill(words.asOf, { time: formatTime(sub.asOf) })}</p>}
        </>
      )}
      {change && sub && (
        <ChangeDialog change={change} sub={sub} busy={busy} error={changeError} onConfirm={confirmChange} onCancel={() => openChange(null)} />
      )}
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
