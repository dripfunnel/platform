import { ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useState } from 'react'
import type { ShopifyProduct } from '../../api/imports'
import { fill, formatCount, messages, plural } from '../../messages'
import { useImportApi } from './importApi'

const words = messages.imports.pick
/** The most startShopifyImport takes by id; more comes in as "all". */
export const maxPicked = 250

type Pick = { kind: 'some'; ids: ReadonlySet<string> } | { kind: 'all' }

/** Connected: the shop's products a page at a time, ticked one by one or all of them, then checked like a file. */
export const ImportPick = ({ shop, checking, onBack, onCheck }: { shop: string; checking: boolean; onBack: () => void; onCheck: (ids: string[] | null) => void }) => {
  const { loadShopifyProducts } = useImportApi()
  const [rows, setRows] = useState<ShopifyProduct[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [view, setView] = useState<'loading' | 'ready' | 'error'>('loading')
  const [pick, setPick] = useState<Pick>({ kind: 'some', ids: new Set() })
  const [note, setNote] = useState<string | null>(null)

  const page = useCallback((after: string | null) => {
    loadShopifyProducts(after).then(
      (found) => {
        // The first page comes ticked, as CatImport opens the picker; the person unticks what stays behind.
        if (after === null) setPick({ kind: 'some', ids: new Set(found.nodes.slice(0, maxPicked).map((r) => r.id)) })
        setRows((current) => (after === null ? found.nodes : [...current, ...found.nodes]))
        setNext(found.next)
        setView('ready')
      },
      () => setView('error'),
    )
  }, [loadShopifyProducts])
  useEffect(() => page(null), [page])

  const toggle = (id: string) => {
    // "All" can't leave out what isn't loaded yet: the API takes picked ids or every product, nothing between.
    if (pick.kind === 'all' && next !== null) return setNote(words.loadAll)
    const ids = new Set(pick.kind === 'some' ? pick.ids : rows.map((r) => r.id))
    if (!ids.delete(id)) ids.add(id)
    if (ids.size > maxPicked) return setNote(words.max)
    setNote(null)
    setPick({ kind: 'some', ids })
  }
  const all = pick.kind === 'all'
  const count = pick.kind === 'some' ? pick.ids.size : null
  const check = () => {
    if (count === 0) return setNote(words.none)
    onCheck(pick.kind === 'all' ? null : [...pick.ids])
  }

  if (view === 'loading') return <LoadingState label={words.loading} />
  if (view === 'error') return <ErrorState title={messages.imports.error.title} body={messages.imports.error.body} retry={{ label: messages.imports.error.retry, onRetry: () => page(null) }} />
  return (
    <section className="df-import-card df-import-pick" aria-label={fill(words.title, { shop })}>
      <div className="df-import-pick-head">
        <h2>{fill(words.title, { shop })}</h2>
        <button type="button" className="df-import-text-button" onClick={() => setPick(all ? { kind: 'some', ids: new Set() } : { kind: 'all' })}>
          {all ? words.clearAll : words.selectAll}
        </button>
      </div>
      {all && <p className="df-import-pick-all">{words.allChosen}</p>}
      <ul className="df-import-pick-rows">
        {rows.map((row) => {
          const on = all || (pick.kind === 'some' && pick.ids.has(row.id))
          return (
            <li key={row.id}>
              <label className="df-import-pick-row">
                <input type="checkbox" checked={on} onChange={() => toggle(row.id)} />
                <span className="df-import-pick-name">{row.title}</span>
                <span className="df-import-pick-meta">
                  {row.status === 'DRAFT' ? `${words.draft} · ` : row.status === 'ARCHIVED' ? `${words.archived} · ` : ''}
                  {fill(plural(words.versions, row.versions), { count: formatCount(row.versions) })}
                </span>
              </label>
            </li>
          )
        })}
      </ul>
      {next && (
        <button type="button" className="df-import-text-button df-import-pick-more" onClick={() => page(next)}>
          {words.more}
        </button>
      )}
      {note && (
        <p className="df-import-problem" role="alert">
          {note}
        </p>
      )}
      <div className="df-import-actions">
        <button type="button" className="df-button" onClick={onBack}>
          {words.back}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={checking} onClick={check}>
          {count === null ? words.checkAll : fill(plural(words.check, count), { count: formatCount(count) })}
        </button>
      </div>
      {checking && <LoadingState label={messages.imports.checking.shopify} />}
    </section>
  )
}
