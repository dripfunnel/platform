import { useEffect, useState } from 'react'
import { loadProducts } from '../../api/products'
import { fill, messages } from '../../messages'
import './productSearch.css'

const words = messages.productSearch

type Search = { kind: 'idle' } | { kind: 'loading' } | { kind: 'failed' } | { kind: 'found'; rows: { id: string; name: string }[] }

/**
 * Find a product by name to pick (related products, a comparison, A+ to copy): looking, nothing matching and a failed
 * search each say so. `hide` leaves out what is already picked, or the product itself.
 */
export const ProductSearch = ({ label, hide, onPick, limit = 8 }: { label: string; hide: readonly string[]; onPick: (product: { id: string; name: string }) => void; limit?: number }) => {
  const [query, setQuery] = useState('')
  const [search, setSearch] = useState<Search>({ kind: 'idle' })
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setSearch({ kind: 'idle' })
    setSearch({ kind: 'loading' })
    let live = true
    const timer = setTimeout(
      () =>
        void loadProducts({ filter: 'all', search: q, supplier: '', sort: 'name' }).then(
          (page) => live && setSearch({ kind: 'found', rows: page.rows.map((r) => ({ id: r.id, name: r.name })) }),
          () => live && setSearch({ kind: 'failed' }),
        ),
      300,
    )
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [query])
  const choices = search.kind === 'found' ? search.rows.filter((p) => !hide.includes(p.id)).slice(0, limit) : []
  return (
    <div className="df-product-search">
      <input type="search" aria-label={label} placeholder={label} value={query} onChange={(e) => setQuery(e.target.value)} />
      <div className="df-product-search-results" role="status">
        {search.kind === 'loading' && <span className="df-product-search-note">{words.looking}</span>}
        {search.kind === 'failed' && <span className="df-product-search-problem">{words.failed}</span>}
        {search.kind === 'found' && choices.length === 0 && <span className="df-product-search-note">{fill(words.none, { query: query.trim() })}</span>}
        {choices.map((p) => (
          <button key={p.id} type="button" className="df-product-search-pick" onClick={() => onPick(p)}>
            + {p.name}
          </button>
        ))}
      </div>
    </div>
  )
}
