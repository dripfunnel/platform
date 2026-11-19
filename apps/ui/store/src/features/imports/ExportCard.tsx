import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import type { CatalogExport } from '../../api/imports'
import type { ProductCounts } from '../../api/products'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { useImportApi } from './importApi'

const words = messages.imports.export
const pollMs = 1500

const countsOf = (products: number | null, versions: number): string => {
  const inVersions = fill(plural(words.versions, versions), { count: formatCount(versions) })
  return products === null ? inVersions : fill(words.counts, { products: fill(plural(words.count, products), { count: formatCount(products) }), versions: inVersions })
}

/** Export: all products or the hidden ones as a job, and the caller's recent files to download while their link lasts. */
export const ExportCard = () => {
  const { loadCatalogExport, loadCatalogExports, loadProductCounts, requestProductExport } = useImportApi()
  const id = useId()
  const [exports, setExports] = useState<CatalogExport[]>([])
  const [sizes, setSizes] = useState<Pick<ProductCounts, 'all' | 'versions' | 'hidden' | 'hiddenVersions'> | null>(null)
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)

  const asked = useRef(new Set<string>())
  const [missing, setMissing] = useState<ReadonlySet<string>>(new Set())

  // The list is read without files, so a ready export is fetched by its id for its file (#1444).
  const refresh = useCallback(
    () => loadCatalogExports().then((listed) => setExports((current) => listed.map((e) => (e.state === 'ready' && !e.url ? (current.find((c) => c.id === e.id && c.url) ?? e) : e))), () => undefined),
    [loadCatalogExports],
  )
  const fetchFile = useCallback(
    (id: string) => {
      asked.current.add(id)
      const lost = (gone: boolean) =>
        setMissing((current) => {
          const next = new Set(current)
          if (gone) next.add(id)
          else next.delete(id)
          return next
        })
      lost(false)
      loadCatalogExport(id).then(
        (full) => (full ? setExports((current) => current.map((c) => (c.id === id ? full : c))) : lost(true)),
        () => lost(true),
      )
    },
    [loadCatalogExport],
  )
  useEffect(() => {
    for (const e of exports) if (e.state === 'ready' && !e.url && !asked.current.has(e.id)) fetchFile(e.id)
  }, [exports, fetchFile])
  useEffect(() => {
    void refresh()
    loadProductCounts().then(setSizes, () => undefined)
  }, [refresh, loadProductCounts])

  const stateOf = (e: CatalogExport): ReactNode => {
    if (e.state === 'expired') return words.expired
    if (e.state === 'preparing') return ''
    if (e.state !== 'ready') return words.failed
    if (!missing.has(e.id)) return words.gettingFile
    return (
      <>
        {words.fileFailed}{' '}
        <button type="button" className="df-import-text-button df-import-link" onClick={() => fetchFile(e.id)}>
          {words.retry}
        </button>
      </>
    )
  }

  const preparing = exports.some((e) => e.state === 'preparing')
  useEffect(() => {
    if (!preparing) return
    const timer = setTimeout(() => void refresh(), pollMs)
    return () => clearTimeout(timer)
  }, [preparing, exports, refresh])

  const ask = async (filter: 'all' | 'hidden') => {
    setAsking(true)
    setFailed(false)
    try {
      const started = await requestProductExport({ filter })
      setExports((current) => [started, ...current.filter((e) => e.id !== started.id)])
    } catch {
      setFailed(true)
    }
    setAsking(false)
  }

  return (
    <section className="df-import-card df-import-export" aria-labelledby={`${id}-title`}>
      <div className="df-import-export-head">
        <h2 id={`${id}-title`} className="df-visually-hidden">
          {words.title}
        </h2>
        <span className="df-import-row-actions">
          <button type="button" className="df-button df-button--small" disabled={asking} onClick={() => void ask('hidden')}>
            {sizes === null ? words.hidden : fill(words.withCounts, { action: words.hidden, counts: countsOf(sizes.hidden, sizes.hiddenVersions) })}
          </button>
          <button type="button" className="df-button df-button--small df-import-export-all" disabled={asking} onClick={() => void ask('all')}>
            {sizes === null ? words.all : fill(words.withCounts, { action: words.all, counts: countsOf(sizes.all, sizes.versions) })}
          </button>
        </span>
      </div>
      <p className="df-import-export-about">{words.note}</p>
      {preparing && (
        <p className="df-import-export-note" role="status">
          {words.preparing}
        </p>
      )}
      {failed && (
        <p className="df-import-problem" role="alert">
          {messages.imports.listExport.failed}
        </p>
      )}
      {exports.length > 0 && (
        <ul className="df-import-export-rows">
          {exports.map((e) => (
            <li key={e.id}>
              <span className="df-import-export-label">{fill(words.row, { label: words.label[e.kind], count: e.entries === null ? words.counting : countsOf(e.products, e.entries) })}</span>
              <span className="df-import-export-date">{formatTime(e.requestedAt)}</span>
              {e.state === 'ready' && e.url ? (
                <a className="df-import-link" href={e.url} download={fill(words.file, { date: e.requestedAt.slice(0, 10) })}>
                  {words.download}
                </a>
              ) : (
                <span className="df-import-export-state" aria-live="polite">
                  {stateOf(e)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
