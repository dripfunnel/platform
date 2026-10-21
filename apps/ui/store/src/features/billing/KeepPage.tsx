import { EmptyState, ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useRouter } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { keepProducts, loadPlanKeep, type PlanKeep } from '../../api/billing'
import { loadProducts, type ProductRow } from '../../api/products'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { refusalIn } from '../common/refusal'
import { billingSeat } from './billingSeat'
import { dayOf } from './billingView'
import { keepSample, keepStates } from './keepStates'
import './billing.css'

const words = messages.keep
const shellRoute = getRouteApi('/_app')
const refused = refusalIn(messages.billing.refused)
const listQuery = { filter: 'all', search: '', supplier: '', sort: 'name' } as const

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; keep: PlanKeep | null; rows: ProductRow[]; next: string | null }

const productsText = (count: number) => fill(plural(words.products, count), { count: formatCount(count) })

/** The Owner's picks as the API kept them: what has an order waiting to ship stays whatever is ticked. */
const picksOf = (keep: PlanKeep | null) => new Set(keep ? keep.kept.filter((id) => !keep.waiting.includes(id)) : [])

/** Choose what to keep (PortalKeep, SAAS §6.2): which products stay on sale on a smaller plan; the rest pause, never deleted. */
export const KeepPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const router = useRouter()
  const forced = useScreenState(keepStates, harnessEnabled)
  const sample = useMemo(() => keepSample(forced), [forced])
  const seat = useMemo(() => billingSeat(forced && { denied: forced === 'denied', readOnly: forced === 'readOnly' }, acting, state), [forced, acting, state])

  const [view, setView] = useState<View>({ kind: 'loading' })
  const [picks, setPicks] = useState<Set<string>>(new Set())
  const [notice, setNotice] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    setNotice(null)
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) {
      setPicks(picksOf(sample.keep))
      return setView({ kind: 'ready', keep: sample.keep, rows: sample.rows, next: null })
    }
    if (!seat.canRead) return
    setView({ kind: 'loading' })
    void Promise.all([loadPlanKeep(), loadProducts(listQuery)]).then(
      ([keep, page]) => {
        if (mine !== latest.current) return
        setPicks(picksOf(keep))
        setView({ kind: 'ready', keep, rows: page.rows, next: page.next })
      },
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, sample, seat.canRead])
  useEffect(load, [load])

  if (!seat.canRead)
    return (
      <div className="df-keep">
        <h1 className="df-page-title">{messages.billing.title}</h1>
        <EmptyState title={words.denied.title} body={words.denied.body} />
      </div>
    )
  if (view.kind !== 'ready')
    return (
      <div className="df-keep">
        {view.kind === 'loading' ? <LoadingState label={words.loading} /> : <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
      </div>
    )

  const { keep, rows, next } = view
  if (!keep || keep.products <= keep.limit)
    return (
      <div className="df-keep">
        <EmptyState title={words.nothing.title} body={words.nothing.body} />
        <Link className="df-button" to="/billing" search={(prev) => harnessSearch(prev)}>
          {words.nothing.action}
        </Link>
      </div>
    )

  const waiting = new Set(keep.waiting)
  const kept = new Set([...picks, ...waiting]).size
  const canSave = seat.canWrite && !seat.readOnly
  const limit = productsText(keep.limit)

  const toggle = (id: string) => {
    setNotice(null)
    if (picks.has(id)) return setPicks((p) => new Set([...p].filter((x) => x !== id)))
    if (kept >= keep.limit) return setNotice(fill(words.full, { plan: keep.plan.name, limit }))
    setPicks((p) => new Set([...p, id]))
  }

  const more = () => {
    if (!next) return
    setBusy(true)
    loadProducts(listQuery, { after: next })
      .then((page) => setView((v) => (v.kind === 'ready' ? { ...v, rows: [...v.rows, ...page.rows], next: page.next } : v)))
      .catch((error: unknown) => setNotice(refused(error)))
      .finally(() => setBusy(false))
  }

  const save = () => {
    setNotice(null)
    if (sample) return setToast(fill(words.saved, { kept: productsText(kept) }))
    setBusy(true)
    keepProducts([...picks])
      .then(async (after) => {
        const count = productsText(new Set([...after.kept, ...after.waiting]).size)
        setPicks(picksOf(after))
        setView((v) => (v.kind === 'ready' ? { ...v, keep: after } : v))
        setToast(after.from ? fill(words.savedFrom, { date: dayOf(after.from), kept: count }) : fill(words.saved, { kept: count }))
        await router.invalidate()
      })
      .catch((error: unknown) => setNotice(refused(error)))
      .finally(() => setBusy(false))
  }

  return (
    <div className="df-keep">
      <div>
        <h1 className="df-page-title">{fill(words.title, { plan: keep.plan.name })}</h1>
        <p className="df-page-lede">{keep.from ? fill(words.from, { date: dayOf(keep.from), plan: keep.plan.name, limit }) : fill(words.now, { plan: keep.plan.name, limit })}</p>
      </div>
      <div>
        <Link className="df-button df-button--primary" to="/billing" search={(prev) => harnessSearch(prev)}>
          {words.plans}
        </Link>
      </div>
      {seat.readOnly && <p className="df-billing-readonly">{words.readOnly}</p>}
      <section className="df-keep-list" aria-labelledby="df-keep-title">
        <div className="df-keep-head">
          <h2 id="df-keep-title">{fill(words.listTitle, { kept: formatCount(kept), limit: formatCount(keep.limit) })}</h2>
          <p className="df-billing-note">{words.listNote}</p>
        </div>
        <ul>
          {rows.map((p) => {
            const locked = waiting.has(p.id)
            const on = locked || picks.has(p.id)
            return (
              <li key={p.id} className={on ? 'df-keep-row df-keep-row--on' : 'df-keep-row'}>
                <label>
                  <input type="checkbox" checked={on} disabled={locked || !canSave || busy} onChange={() => toggle(p.id)} />
                  <span className="df-keep-name">
                    <strong>{p.name}</strong>
                    {locked ? <span>{words.waiting}</span> : p.supplier ? <span>{fill(words.supplier, { supplier: p.supplier.name })}</span> : null}
                  </span>
                  <span className={on ? 'df-keep-state df-keep-state--on' : 'df-keep-state'}>{on ? words.stays : words.paused}</span>
                </label>
              </li>
            )
          })}
        </ul>
        {next && (
          <button type="button" className="df-button df-keep-more" disabled={busy} onClick={more}>
            {words.more}
          </button>
        )}
      </section>
      <p className="df-keep-note">{words.note}</p>
      {notice && (
        <p className="df-billing-refusal" role="alert">
          {notice}
        </p>
      )}
      <div className="df-keep-actions">
        <Link className="df-button" to="/home" search={(prev) => harnessSearch(prev)}>
          {words.back}
        </Link>
        {canSave && (
          <button type="button" className="df-button df-keep-save" disabled={busy} onClick={save}>
            {keep.from ? fill(words.saveFrom, { date: dayOf(keep.from) }) : words.save}
          </button>
        )}
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
