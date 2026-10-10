import { EmptyState, ErrorState, ExportJobStatus, InfoNote, LoadingState, StatusPill, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { requestOrderExport } from '../../api/orders'
import { loadMySales, salePageSize, type Sale, type SalePage } from '../../api/sales'
import { harnessEnabled } from '../../harness'
import { fill, formatCount, messages } from '../../messages'
import { startListExport, useListExport } from '../common/listExport'
import { moneyText, orderExportWords } from '../orders/orderView'
import { salesSample, salesStates, type SalesState } from './salesStates'
import { dayText, salePill, saleStatus } from './salesView'
import './sales.css'

const words = messages.sales
const pages = messages.orders.pages
const shellRoute = getRouteApi('/_app')

// A page carries its own place in the list, so turning twice before the answer never miscounts it.
type Cursor = { after?: string | null; before?: string | null; index: number }
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: SalePage; index: number }

interface SalesSeat {
  canRead: boolean
  supplier: boolean
  canExport: boolean
}

// `sales.read` and `exports.orders` are the two order tiers' (ACCESS §5.2); the API refuses everyone else as well.
const seatOf = (forced: SalesState | null, acting: { permissions: readonly string[]; seller: unknown }): SalesSeat => {
  if (forced === 'denied') return { canRead: false, supplier: true, canExport: false }
  if (forced) return { canRead: true, supplier: true, canExport: true }
  const supplier = acting.seller !== null
  const has = (p: string) => supplier && acting.permissions.includes(p)
  return { canRead: has('sales.read'), supplier, canExport: has('exports.orders') }
}

/** Your sales (VendorViews "sales", FIRST-RELEASE §17): a supplier's own sold lines, no totals; ?state= per salesStates.ts. */
export const SalesPage = () => {
  const { acting } = shellRoute.useLoaderData()
  const forced = useScreenState(salesStates, harnessEnabled)
  const sample = useMemo(() => salesSample(forced), [forced])
  const seat = useMemo(() => seatOf(forced, acting), [forced, acting])
  const exportJob = useListExport('orders')

  const [cursor, setCursor] = useState<Cursor>({ index: 0 })
  const [view, setView] = useState<View>({ kind: 'loading' })
  const latest = useRef(0)

  // Only the latest request answers: a slow page asked for before never replaces the one on screen.
  const load = useCallback(() => {
    const mine = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (sample) return setView({ kind: 'ready', page: { rows: sample, next: null, previous: null }, index: 0 })
    if (!seat.canRead) return
    setView((current) => (current.kind === 'error' ? { kind: 'loading' } : current))
    const { index, ...at } = cursor
    void loadMySales(at).then(
      (page) => {
        if (mine === latest.current) setView({ kind: 'ready', page, index })
      },
      () => {
        if (mine === latest.current) setView({ kind: 'error' })
      },
    )
  }, [forced, sample, seat.canRead, cursor])
  useEffect(load, [load])

  const supplier = acting.seller?.name ?? ''
  const store = acting.store.name

  if (!seat.canRead)
    return (
      <div className="df-sales">
        <h1 className="df-page-title">{words.title}</h1>
        <EmptyState title={words.denied.title} body={seat.supplier ? fill(words.denied.supplier, { store }) : words.denied.merchant} />
      </div>
    )

  const rows = view.kind === 'ready' ? view.page.rows : []
  const isEmpty = view.kind === 'ready' && rows.length === 0 && view.index === 0

  return (
    <div className="df-sales">
      <div className="df-sales-head">
        <div>
          <h1 className="df-page-title">{words.title}</h1>
          <p className="df-page-lede">
            {fill(words.sub, { supplier, store })}
            <span className="df-sales-zone">{words.datesIn}</span>
          </p>
        </div>
        {seat.canExport && view.kind === 'ready' && !isEmpty && (
          <button type="button" className="df-button" disabled={exportJob?.state === 'preparing' || Boolean(sample)} onClick={() => void startListExport('orders', requestOrderExport('ALL', ''))}>
            {words.export}
          </button>
        )}
      </div>
      {exportJob && (
        <p className="df-sales-export" role="status">
          <ExportJobStatus job={exportJob} words={orderExportWords} />
        </p>
      )}
      <InfoNote>{words.note}</InfoNote>

      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
      {isEmpty && <EmptyState title={words.empty.title} body={words.empty.body} />}

      {view.kind === 'ready' && !isEmpty && (
        <>
          <table className="df-sales-table" aria-label={words.list}>
            <thead>
              <tr>
                <th scope="col">{words.columns.order}</th>
                <th scope="col">{words.columns.product}</th>
                <th scope="col">{words.columns.quantity}</th>
                <th scope="col">{words.columns.line}</th>
                <th scope="col">{words.columns.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((sale) => (
                <SaleRow key={sale.lineId} sale={sale} />
              ))}
            </tbody>
          </table>
          {(view.page.next || view.page.previous) && (
            <nav className="df-sales-pager" aria-label={pages.label}>
              <span>{fill(pages.showing, { from: formatCount(view.index * salePageSize + 1), to: formatCount(view.index * salePageSize + rows.length) })}</span>
              <span>
                <button type="button" className="df-button" disabled={!view.page.previous} onClick={() => setCursor({ before: view.page.previous, index: Math.max(0, view.index - 1) })}>
                  {pages.previous}
                </button>
                <button type="button" className="df-button" disabled={!view.page.next} onClick={() => setCursor({ after: view.page.next, index: view.index + 1 })}>
                  {pages.next}
                </button>
              </span>
            </nav>
          )}
        </>
      )}
    </div>
  )
}

const SaleRow = ({ sale }: { sale: Sale }) => {
  const status = saleStatus(sale)
  const label = status === 'partlyRefunded' ? fill(words.status.partlyRefunded, { count: formatCount(sale.refundedQuantity), quantity: formatCount(sale.quantity) }) : words.status[status]
  return (
    <tr>
      <td className="df-sales-cell">
        <strong className="df-sales-number">{sale.orderNumber}</strong>
        <span className="df-sales-sub">{dayText(sale.placedAt)}</span>
      </td>
      <td className="df-sales-cell">
        <span>{sale.name}</span>
        {sale.versionName && <span className="df-sales-sub">{sale.versionName}</span>}
      </td>
      <td>{fill(words.quantity, { count: formatCount(sale.quantity) })}</td>
      <td className="df-sales-money">{moneyText(sale.amount)}</td>
      <td>
        <StatusPill {...salePill[status]} label={label} />
      </td>
    </tr>
  )
}
