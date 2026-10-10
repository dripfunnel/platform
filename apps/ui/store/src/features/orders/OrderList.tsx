import { EmptyState, ErrorState, ExportJobStatus, LoadingState, SearchField, StatusPill, usePhone, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/list.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { loadOrderCounts, loadOrders, loadStoreTimeZone, orderPageSize, requestOrderExport, type OrderCounts, type OrderFilter, type OrderPage, type OrderSummary } from '../../api/orders'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, formatCount, messages, plural } from '../../messages'
import { startListExport, useListExport } from '../common/listExport'
import '../common/chips.css'
import { orderListSample, orderListStates } from './orderStates'
import { ordersSeatOf } from './ordersAccess'
import { chipsFor, countKey, moneyText, orderExportWords, paymentOf, rowStatus, statusPill, timeText, zoneName, type OrdersAccess } from './orderView'
import './orders.css'

const words = messages.orders
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/orders')

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: OrderPage; counts: OrderCounts }
type Cursor = { after?: string | null; before?: string | null }

/** Orders (PortalOrders, FIRST-RELEASE §6): the store's orders, or a supplier's To ship; ?state= per orderStates.ts. */
export const OrderList = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const forced = useScreenState(orderListStates, harnessEnabled)
  const sample = useMemo(() => orderListSample(forced), [forced])
  const { canRead, access } = useMemo(() => ordersSeatOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const phone = usePhone()
  const exportJob = useListExport('orders')

  const { filter: opened } = pageRoute.useSearch()
  const [filter, setFilter] = useState<OrderFilter>(() => (opened && chipsFor(access.supplier).includes(opened) ? opened : 'ALL'))
  const [search, setSearch] = useState('')
  const [cursor, setCursor] = useState<Cursor>({})
  const [pageIndex, setPageIndex] = useState(0)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [timeZone, setTimeZone] = useState('UTC')
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return setView({ kind: 'ready', page: { rows: sample.rows, next: null, previous: null }, counts: sample.counts })
    if (!canRead) return
    setView((current) => (current.kind === 'error' ? { kind: 'loading' } : current))
    void Promise.all([loadOrders(filter, search, cursor), loadOrderCounts()]).then(
      ([page, counts]) => {
        if (mine === latest.current) setView({ kind: 'ready', page, counts })
      },
      () => {
        if (mine === latest.current) setView({ kind: 'error' })
      },
    )
  }, [forced, sample, canRead, filter, search, cursor])
  useEffect(load, [load])

  // Times are the store's; until its zone answers (or for a supplier, which reads no settings) they say UTC.
  useEffect(() => {
    if (forced) return setTimeZone(access.supplier ? 'UTC' : 'Asia/Kolkata')
    if (access.supplier || !canRead) return
    void loadStoreTimeZone().then((zone) => setTimeZone(zone ?? 'UTC'), () => setTimeZone('UTC'))
  }, [forced, access.supplier, canRead])

  const change = (next: { filter?: OrderFilter; search?: string }) => {
    if (next.filter !== undefined) setFilter(next.filter)
    if (next.search !== undefined) setSearch(next.search)
    setCursor({})
    setPageIndex(0)
  }
  const page = (next: Cursor, step: number) => {
    setCursor(next)
    setPageIndex((index) => Math.max(0, index + step))
  }

  const title = access.supplier ? words.titleSupplier : words.title
  if (!canRead)
    return (
      <div className="df-orders">
        <h1 className="df-page-title">{title}</h1>
        <EmptyState title={words.denied.title} body={words.denied.body} />
      </div>
    )

  const rows = view.kind === 'ready' ? view.page.rows : []
  const filtered = filter !== 'ALL' || search !== ''
  const isEmpty = view.kind === 'ready' && view.counts.all === 0 && !filtered
  const canExport = access.canExport && !phone && !isEmpty

  return (
    <div className="df-orders">
      <div className="df-orders-head">
        <div>
          <h1 className="df-page-title">{title}</h1>
          {view.kind === 'ready' && !isEmpty && (
            <p className="df-page-lede">
              {access.supplier ? words.summarySupplier : fill(plural(words.summary, view.counts.all), { count: formatCount(view.counts.all), toShip: formatCount(view.counts.toShip) })}
              <span className="df-orders-zone">{fill(words.timesIn, { zone: zoneName(timeZone) })}</span>
            </p>
          )}
        </div>
        {canExport && (
          <button type="button" className="df-button" disabled={exportJob?.state === 'preparing' || Boolean(sample)} onClick={() => void startListExport('orders', requestOrderExport(filter, search))}>
            {words.export.button}
          </button>
        )}
      </div>
      {exportJob && (
        <p className="df-orders-export" role="status">
          <ExportJobStatus job={exportJob} words={orderExportWords} />
        </p>
      )}

      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
      {isEmpty && <EmptyState title={access.supplier ? words.emptySupplier.title : words.empty.title} body={access.supplier ? words.emptySupplier.body : words.empty.body} />}

      {view.kind === 'ready' && !isEmpty && (
        <>
          <div className="df-orders-toolbar">
            <SearchField label={words.search.label} placeholder={access.supplier ? words.search.placeholderSupplier : words.search.placeholder} value={search || undefined} onChange={(value) => change({ search: value ?? '' })} />
            <div className="df-chips" role="group" aria-label={words.chips.label}>
              {chipsFor(access.supplier).map((f) => (
                <button key={f} type="button" className="df-chip" aria-pressed={filter === f} onClick={() => change({ filter: f })}>
                  {words.chips[f]}
                  <span>{formatCount(view.counts[countKey[f]])}</span>
                </button>
              ))}
            </div>
          </div>

          {rows.length === 0 ? (
            <section className="df-state" aria-labelledby="df-orders-none">
              <h2 id="df-orders-none">{search ? fill(words.noResults.search, { search }) : words.noResults.filters}</h2>
              <p>{words.noResults.body}</p>
              <div className="df-actions">
                <button type="button" className="df-button" onClick={() => change({ filter: 'ALL', search: '' })}>
                  {words.noResults.clear}
                </button>
              </div>
            </section>
          ) : (
            <>
              <ul className="df-orders-rows" aria-label={words.list.label}>
                {rows.map((row) => (
                  <OrderRow key={row.id} row={row} access={access} timeZone={timeZone} store={acting.store.name} sample={Boolean(sample)} />
                ))}
              </ul>
              {(view.page.next || view.page.previous) && (
                <nav className="df-orders-pager" aria-label={words.pages.label}>
                  <span>{fill(words.pages.showing, { from: formatCount(pageIndex * orderPageSize + 1), to: formatCount(pageIndex * orderPageSize + rows.length) })}</span>
                  <span>
                    <button type="button" className="df-button" disabled={!view.page.previous} onClick={() => page({ before: view.page.previous }, -1)}>
                      {words.pages.previous}
                    </button>
                    <button type="button" className="df-button" disabled={!view.page.next} onClick={() => page({ after: view.page.next }, 1)}>
                      {words.pages.next}
                    </button>
                  </span>
                </nav>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}

const OrderRow = ({ row, access, timeZone, store, sample }: { row: OrderSummary; access: OrdersAccess; timeZone: string; store: string; sample: boolean }) => {
  const status = rowStatus(row, access.supplier)
  const pay = paymentOf(row.paymentState)
  const who = access.supplier ? (row.customerName ?? fill(words.row.forStore, { store })) : (row.customerName ?? words.row.guest)
  const where = access.supplier ? (row.shippingMode === 'to-shopper' ? row.city || words.row.toShopper : words.row.sendToStore) : row.city
  return (
    <li>
      <Link className="df-orders-row" data-money={access.money || undefined} to="/orders/$orderId" params={{ orderId: row.id }} search={(prev) => harnessSearch(prev, sample ? (access.supplier ? 'supplier' : 'toShip') : undefined)}>
        <span className="df-orders-cell">
          <strong className="df-orders-number">{row.number}</strong>
          <span className="df-orders-sub">{timeText(row.placedAt, timeZone)}</span>
        </span>
        <span className="df-orders-cell df-orders-who">
          <span className="df-orders-name">{who}</span>
          {where && <span className="df-orders-sub">{where}</span>}
        </span>
        <span className="df-orders-items">{fill(plural(words.row.items, row.items), { count: formatCount(row.items) })}</span>
        <span className="df-orders-status">
          <StatusPill {...statusPill[status]} label={words.status[status]} />
          {row.test && <span className="df-orders-test">{words.row.test}</span>}
        </span>
        {access.money && (
          <span className="df-orders-cell df-orders-money">
            <span>{row.total ? moneyText(row.total) : ''}</span>
            {pay && <span className={pay === 'pending' ? 'df-orders-pay df-orders-pay--pending' : 'df-orders-pay'}>{words.payment[pay]}</span>}
          </span>
        )}
      </Link>
    </li>
  )
}
