import { StatusPill, type StatusIconName, type StatusTone } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import type { ProductRow } from '../../api/products'
import { fill, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { QuickEdit } from './QuickEdit'
import { priceText, readyOf, reviewChecks, statusOf, stockOf, subOf, type ProductAccess, type RowStatus } from './productView'

const words = messages.products

const pill: Record<RowStatus, { tone: StatusTone; icon: StatusIconName }> = {
  visible: { tone: 'success', icon: 'ok' },
  hidden: { tone: 'neutral', icon: 'pause' },
  pending: { tone: 'warning', icon: 'hour' },
  sent_back: { tone: 'danger', icon: 'pen' },
}

const Status = ({ row }: { row: ProductRow }) => {
  const status = statusOf(row)
  return <StatusPill {...pill[status]} label={words.status[status]} />
}

const Thumb = ({ row }: { row: ProductRow }) =>
  row.photoUrl ? <AssetImage className="df-products-thumb" url={row.photoUrl} alt="" placeholder="" /> : <span className="df-products-thumb df-products-thumb--none">{words.row.noPhoto}</span>

export interface ProductRowsProps {
  rows: readonly ProductRow[]
  access: ProductAccess
  selected: ReadonlySet<string>
  reviewing: string | null
  busy: boolean
  onToggle: (id: string) => void
  onTogglePage: () => void
  onReview: (id: string | null) => void
  onApprove: (row: ProductRow) => void
  onSendBack: (row: ProductRow) => void
  /** The row whose quick edit is open, and the toggle; null when quick edit isn't offered. */
  quick: { open: string | null; toggle: (id: string | null) => void; done: (text: string) => void } | null
  /** The pager, drawn inside the table's card as CatList does. */
  footer: ReactNode
}

const canReview = (access: ProductAccess, row: ProductRow) => access.canApprove && row.approval === 'pending'

const Review = ({ row, busy, onApprove, onSendBack }: { row: ProductRow; busy: boolean; onApprove: () => void; onSendBack: () => void }) => (
  <div className="df-products-review" role="region" aria-label={fill(words.review.title, { supplier: row.supplier?.name ?? '' })}>
    <div className="df-products-review-head">
      <strong>{fill(words.review.title, { supplier: row.supplier?.name ?? '' })}</strong>
      <span>{words.review.note}</span>
    </div>
    <ul className="df-products-checks">
      {reviewChecks(row).map((check) => (
        <li key={check.label} className={check.ok ? 'df-products-check--ok' : 'df-products-check--warn'}>
          <span aria-hidden="true">{check.ok ? '✓' : '⚠'}</span> {check.label}
        </li>
      ))}
    </ul>
    <div className="df-products-review-actions">
      <Link className="df-button" to="/products/$productId" params={{ productId: row.id }}>
        {words.review.edit}
      </Link>
      <button type="button" className="df-button df-products-send-back" disabled={busy} onClick={onSendBack}>
        {words.review.sendBack}
      </button>
      <button type="button" className="df-button df-products-approve" disabled={busy} onClick={onApprove}>
        {words.review.approve}
      </button>
    </div>
  </div>
)

/** CatList's desktop table: select, product, status, price, stock, supplier, readiness and the review toggle. */
export const ProductTable = ({ rows, access, selected, reviewing, busy, onToggle, onTogglePage, onReview, onApprove, onSendBack, quick, footer }: ProductRowsProps) => {
  const pageSelected = rows.length > 0 && rows.every((r) => selected.has(r.id))
  const columns = 6 + (access.canSelect ? 1 : 0) + (access.seeSuppliers ? 1 : 0)
  return (
    <div className="df-products-frame">
      <div className="df-table-scroll">
        <table className="df-table df-products-table">
          <thead>
            <tr>
              {access.canSelect && (
                <th className="df-products-select">
                  <input type="checkbox" aria-label={words.columns.select} checked={pageSelected} onChange={onTogglePage} />
                </th>
              )}
              <th>{words.columns.product}</th>
              <th>{words.columns.status}</th>
              <th>{words.columns.price}</th>
              <th>{words.columns.stock}</th>
              {access.seeSuppliers && <th>{words.columns.supplier}</th>}
              <th>{words.columns.ready}</th>
              <th aria-hidden="true" />
            </tr>
          </thead>
          <tbody>
            {rows.flatMap((row) => {
              const stock = stockOf(row)
              const ready = readyOf(row)
              const review = canReview(access, row)
              const open = reviewing === row.id && review
              const quickable = row.approval !== 'pending'
              const quicking = quickable && quick?.open === row.id
              const line = (
                <tr key={row.id} className={selected.has(row.id) ? 'df-products-row--selected' : undefined}>
                  {access.canSelect && (
                    <td className="df-products-select">
                      <input type="checkbox" aria-label={fill(words.row.select, { name: row.name })} checked={selected.has(row.id)} onChange={() => onToggle(row.id)} />
                    </td>
                  )}
                  <td>
                    <Link className="df-products-name" to="/products/$productId" params={{ productId: row.id }}>
                      <Thumb row={row} />
                      <span className="df-products-name-text">
                        <strong>{row.name}</strong>
                        <span>{subOf(row)}</span>
                      </span>
                    </Link>
                  </td>
                  <td>
                    <Status row={row} />
                  </td>
                  <td className="df-products-price">{priceText(row)}</td>
                  <td className={`df-products-stock df-products-stock--${stock.tone}`}>{stock.text}</td>
                  {access.seeSuppliers && <td>{row.supplier?.name ?? words.row.you}</td>}
                  <td className={ready?.ready === false ? 'df-products-ready df-products-ready--no' : 'df-products-ready'}>{ready?.text ?? ''}</td>
                  <td>
                    {review && (
                      <button type="button" className="df-products-review-toggle" aria-expanded={open} onClick={() => onReview(open ? null : row.id)}>
                        {open ? words.row.close : words.row.review}
                      </button>
                    )}
                    {quickable && quick && (
                      <button type="button" className="df-products-quick-toggle" aria-expanded={quicking} aria-label={`${quicking ? words.quick.close : words.quick.open} ${row.name}`} onClick={() => quick.toggle(quicking ? null : row.id)}>
                        {quicking ? words.quick.close : words.quick.open}
                      </button>
                    )}
                  </td>
                </tr>
              )
              if (quicking && quick)
                return [
                  line,
                  <tr key={`${row.id}-quick`} className="df-products-review-row">
                    <td colSpan={columns}>
                      <QuickEdit productId={row.id} side={access.supplier ? 'supplier' : 'merchant'} canPrice={access.quickPrice} canStock={access.quickStock} onDone={quick.done} onCancel={() => quick.toggle(null)} />
                    </td>
                  </tr>,
                ]
              if (!open) return [line]
              return [
                line,
                <tr key={`${row.id}-review`} className="df-products-review-row">
                  <td colSpan={columns}>
                    <Review row={row} busy={busy} onApprove={() => onApprove(row)} onSendBack={() => onSendBack(row)} />
                  </td>
                </tr>,
              ]
            })}
          </tbody>
        </table>
      </div>
      {footer}
    </div>
  )
}

/** The phone's cards: a tap opens the product; a waiting one carries Send back and Approve under it. */
export const ProductCards = ({ rows, access, busy, onApprove, onSendBack, footer }: ProductRowsProps) => (
  <>
    <ul className="df-products-cards">
      {rows.map((row) => {
        const stock = stockOf(row)
        return (
          <li key={row.id}>
            <Link className="df-products-card" to="/products/$productId" params={{ productId: row.id }}>
              <Thumb row={row} />
              <span className="df-products-card-text">
                <strong>{row.name}</strong>
                <span>{priceText(row)}</span>
                <span className={`df-products-stock--${stock.tone}`}>
                  {stock.text} · {words.status[statusOf(row)]}
                </span>
              </span>
              <span aria-hidden="true">›</span>
            </Link>
            {canReview(access, row) && (
              <div className="df-products-card-review">
                <button type="button" className="df-button df-products-send-back" disabled={busy} onClick={() => onSendBack(row)}>
                  {words.review.sendBack}
                </button>
                <button type="button" className="df-button df-products-approve" disabled={busy} onClick={() => onApprove(row)}>
                  {words.review.approveShort}
                </button>
              </div>
            )}
          </li>
        )
      })}
    </ul>
    {footer}
  </>
)
