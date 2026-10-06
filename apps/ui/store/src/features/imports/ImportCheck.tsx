import { isApiError } from '@dripfunnel/shared/graphql'
import { useId, useState } from 'react'
import type { CatalogImport } from '../../api/imports'
import type { Place } from '../../api/stock'
import { fill, formatCount, messages, plural } from '../../messages'
import { downloadCsv } from './download'

const words = messages.imports.check

interface CheckProps {
  job: CatalogImport
  name: string
  readOnly: boolean
  places: Place[]
  onRestart: () => void
  onRun: (matching: 'update' | 'skip', warehouseId: string | null) => Promise<void>
}

/** Check: what's ready, what needs fixing and why, what to do with products already here, and where stock goes. */
export const ImportCheck = ({ job, name, readOnly, places, onRestart, onRun }: CheckProps) => {
  const id = useId()
  const [matching, setMatching] = useState<'update' | 'skip'>('update')
  const [place, setPlace] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const chosen = place ?? places.find((p) => p.isDefault)?.id ?? places[0]?.id ?? null
  const withProblems = job.products - job.ready
  const count = matching === 'update' ? job.ready : job.ready - job.matched
  const more = job.problemCount - job.problems.length

  const run = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      await onRun(matching, chosen)
    } catch (error) {
      setBusy(false)
      setRefusal(isApiError(error) ? error.message : messages.imports.error.body)
    }
  }

  return (
    <>
      <div className="df-import-cards">
        <div className="df-import-card df-import-tally df-import-tally--ok">
          <span className="df-import-mono">{job.source === 'shopify' ? name : fill(words.fileName, { name, count: fill(plural(words.rows, job.products), { count: formatCount(job.products) }) })}</span>
          <strong>{fill(words.ready, { count: formatCount(job.ready) })}</strong>
          <span>{fill(words.readyNote, { new: formatCount(job.ready - job.matched), matched: formatCount(job.matched) })}</span>
        </div>
        <div className={`df-import-card df-import-tally${withProblems > 0 ? ' df-import-tally--problems' : ''}`}>
          <span className="df-import-mono">{words.problemsLabel}</span>
          <strong>{fill(words.problems, { count: formatCount(withProblems) })}</strong>
          <span>{words.problemsBody}</span>
        </div>
        <fieldset className="df-import-card df-import-choices">
          <legend>{fill(words.existing, { count: formatCount(job.matched) })}</legend>
          {(['update', 'skip'] as const).map((mode) => (
            <label key={mode} className="df-import-choice">
              <input type="radio" name={`${id}-matching`} checked={matching === mode} onChange={() => setMatching(mode)} />
              {words[mode]}
            </label>
          ))}
          {places.length > 0 && (
            <label className="df-import-place">
              <span>{words.stockIn}</span>
              <select value={chosen ?? ''} onChange={(event) => setPlace(event.target.value)}>
                {places.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isDefault ? fill(words.isDefault, { name: p.name }) : p.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      </div>

      {job.problems.length > 0 && (
        <section className="df-import-card df-import-fix" aria-labelledby={`${id}-fix`}>
          <div className="df-import-fix-head">
            <h2 id={`${id}-fix`}>{words.fix}</h2>
            {job.problemsCsv && (
              <button type="button" className="df-import-text-button df-import-link" onClick={() => downloadCsv(job.problemsCsv ?? '', words.problemsFile)}>
                {words.download}
              </button>
            )}
          </div>
          <ul>
            {job.problems.map((p) => (
              <li key={`${p.line}-${p.column ?? ''}-${p.code}`} className="df-import-fix-row">
                <span className="df-import-mono">{fill(words.row, { line: String(p.line) })}</span>
                <span className="df-import-mono">{p.column ?? words.file}</span>
                <span>{p.message}</span>
              </li>
            ))}
          </ul>
          {more > 0 && <p className="df-import-hint">{fill(plural(words.moreProblems, more), { count: formatCount(more) })}</p>}
        </section>
      )}

      {refusal && (
        <p className="df-import-problem" role="alert">
          {refusal}
        </p>
      )}
      <div className="df-import-actions">
        <button type="button" className="df-button" onClick={onRestart}>
          {words.restart}
        </button>
        <button type="button" className="df-button df-button--primary" disabled={readOnly || busy || count === 0} onClick={() => void run()}>
          {fill(plural(words.run, count), { count: formatCount(count) })}
        </button>
      </div>
    </>
  )
}
