import '@dripfunnel/shared/ui/states.css'
import { useEffect, useId, useRef, useState } from 'react'
import { loadProducts, type ProductRow } from '../../api/products'
import { fill, formatCount, messages, plural } from '../../messages'
import { moneyText } from '../orders/orderView'

// "Choose products" (OfferEditor's picker, D2): search the catalogue and tick products. Picking one means all its
// versions, now and later (#337).

const words = messages.offers.editor.picker

type Found = { kind: 'loading' } | { kind: 'failed' } | { kind: 'ready'; rows: ProductRow[] }

export const ProductPicker = ({ chosen, onToggle, onClose }: { chosen: readonly string[]; onToggle: (product: { id: string; name: string }, on: boolean) => void; onClose: () => void }) => {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const [q, setQ] = useState('')
  const [found, setFound] = useState<Found>({ kind: 'loading' })
  const latest = useRef(0)

  useEffect(() => {
    const dialog = ref.current
    if (dialog && !dialog.open) dialog.showModal()
  }, [])

  // Only the latest search answers, whatever order the answers come back in.
  useEffect(() => {
    const mine = ++latest.current
    setFound({ kind: 'loading' })
    const timer = setTimeout(
      () =>
        void loadProducts({ filter: 'all', search: q, supplier: '', sort: 'name' }).then(
          (page) => mine === latest.current && setFound({ kind: 'ready', rows: page.rows }),
          () => mine === latest.current && setFound({ kind: 'failed' }),
        ),
      250,
    )
    return () => clearTimeout(timer)
  }, [q])

  return (
    <dialog
      ref={ref}
      className="df-dialog df-offer-picker"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <h2 id={titleId}>{words.title}</h2>
      <input type="search" value={q} aria-label={words.search} placeholder={words.search} onChange={(e) => setQ(e.target.value)} />
      <div className="df-offer-picker-list" role="status">
        {found.kind === 'loading' && <span className="df-offers-sub">{words.searching}</span>}
        {found.kind === 'failed' && <span className="df-offers-error">{words.failed}</span>}
        {found.kind === 'ready' && found.rows.length === 0 && <span className="df-offers-sub">{fill(words.none, { query: q.trim() })}</span>}
        {found.kind === 'ready' &&
          found.rows.map((p) => {
            const on = chosen.includes(p.id)
            return (
              <label key={p.id} className="df-offer-picker-row">
                <input type="checkbox" checked={on} onChange={() => onToggle({ id: p.id, name: p.name }, !on)} />
                <span>
                  <strong>{p.name}</strong>
                  <span className="df-offers-sub">{fill(plural(words.versions, p.versionCount), { count: formatCount(p.versionCount) })}</span>
                </span>
                <span>{p.minPrice ? moneyText(p.minPrice) : ''}</span>
              </label>
            )
          })}
      </div>
      <div className="df-actions">
        <button type="button" className="df-button df-button--primary" onClick={onClose}>
          {fill(plural(words.done, chosen.length), { count: formatCount(chosen.length) })}
        </button>
      </div>
    </dialog>
  )
}
