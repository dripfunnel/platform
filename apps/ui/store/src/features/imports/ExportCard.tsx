import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { CatalogExport } from '../../api/imports'
import { fill, formatCount, formatTime, messages, plural } from '../../messages'
import { useImportApi } from './importApi'

const words = messages.imports.export
const pollMs = 1500

/** Export: all products or the hidden ones as a job, and the caller's recent files to download while their link lasts. */
export const ExportCard = () => {
  const { loadCatalogExport, loadCatalogExports, loadProductCounts, requestProductExport } = useImportApi()
  const id = useId()
  const [exports, setExports] = useState<CatalogExport[]>([])
  const [total, setTotal] = useState<number | null>(null)
  const [asking, setAsking] = useState(false)
  const [failed, setFailed] = useState(false)

  const asked = useRef(new Set<string>())

  // The list is read without files, so a ready export is fetched by its id for its file (#1444).
  const refresh = useCallback(
    () => loadCatalogExports().then((listed) => setExports((current) => listed.map((e) => (e.state === 'ready' && !e.url ? (current.find((c) => c.id === e.id && c.url) ?? e) : e))), () => undefined),
    [loadCatalogExports],
  )
  useEffect(() => {
    for (const e of exports) {
      if (e.state !== 'ready' || e.url || asked.current.has(e.id)) continue
      asked.current.add(e.id)
      loadCatalogExport(e.id).then(
        (full) => full && setExports((current) => current.map((c) => (c.id === e.id ? full : c))),
        () => asked.current.delete(e.id),
      )
    }
  }, [exports, loadCatalogExport])
  useEffect(() => {
    void refresh()
    loadProductCounts().then((counts) => setTotal(counts.all), () => undefined)
  }, [refresh, loadProductCounts])

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
        <h2 id={`${id}-title`}>{words.title}</h2>
        <span className="df-import-row-actions">
          <button type="button" className="df-button df-button--small" disabled={asking} onClick={() => void ask('hidden')}>
            {words.hidden}
          </button>
          <button type="button" className="df-button df-button--small df-import-export-all" disabled={asking} onClick={() => void ask('all')}>
            {fill(words.all, { count: total === null ? '' : formatCount(total) }).trim()}
          </button>
        </span>
      </div>
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
              <span className="df-import-export-label">{fill(words.row, { label: words.label[e.kind], count: e.entries === null ? words.counting : fill(plural(words.count, e.entries), { count: formatCount(e.entries) }) })}</span>
              <span className="df-import-export-date">{formatTime(e.requestedAt)}</span>
              {e.state === 'ready' && e.url ? (
                <a className="df-import-link" href={e.url} download={fill(words.file, { date: e.requestedAt.slice(0, 10) })}>
                  {words.download}
                </a>
              ) : (
                <span className="df-import-export-state">{e.state === 'expired' ? words.expired : e.state === 'preparing' || e.state === 'ready' ? '' : words.failed}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
