import { ErrorState, LoadingState } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useRef, useState } from 'react'
import { codeBatchLimits, codeLengths, codePrefixPattern, generateCodes, loadCodeBatches, loadCodesExport, requestCodesExport, type CodeBatch } from '../../api/offers'
import { fill, formatCount, messages, plural } from '../../messages'
import { offerRefusal } from './offerActions'

// Single-use codes (H4): an offer's runs of codes, each with its used and unused, its file, and making another run.

const words = messages.offers.codes

// Runs are read a page at a time; "Show more runs" adds the next page below (an offer can hold hundreds).
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; batches: CodeBatch[]; next: string | null; more: 'idle' | 'loading' | 'failed' }
type Job = { kind: 'preparing' } | { kind: 'ready'; url: string; rows: number } | { kind: 'failed'; message: string }

const pollMs = 1500
// The run's export job outlives a reload of the tab, so a file asked for is never lost (a review lesson, #314).
const jobKey = (batchId: string) => `df-offer-codes:${batchId}`

const fileName = (b: CodeBatch) => `${(b.prefix || 'codes').toLowerCase().replace(/[^a-z0-9]+/g, '')}-codes.csv`

/** One run's file: asked for, followed until the API has made it, then a link to download. */
const BatchFile = ({ batch, sample, canExport }: { batch: CodeBatch; sample: boolean; canExport: boolean }) => {
  const [job, setJob] = useState<Job | null>(null)
  const [jobId, setJobId] = useState<string | null>(() => (typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(jobKey(batch.id))))

  useEffect(() => {
    if (!jobId) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const forget = () => sessionStorage.removeItem(jobKey(batch.id))
    const check = () =>
      void loadCodesExport(jobId).then(
        (answer) => {
          if (!live) return
          if (!answer || answer.state === 'failed' || answer.state === 'expired') {
            forget()
            return setJob({ kind: 'failed', message: answer?.state === 'expired' ? words.expired : words.fileFailed })
          }
          if (answer.state === 'queued') {
            setJob({ kind: 'preparing' })
            timer = setTimeout(check, pollMs)
            return
          }
          forget()
          setJob({ kind: 'ready', url: URL.createObjectURL(new Blob([answer.csv ?? ''], { type: 'text/csv' })), rows: answer.rows ?? 0 })
        },
        () => live && setJob({ kind: 'failed', message: words.fileFailed }),
      )
    check()
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [jobId, batch.id])

  useEffect(() => () => void (job?.kind === 'ready' && URL.revokeObjectURL(job.url)), [job])

  const ask = () => {
    setJob({ kind: 'preparing' })
    void requestCodesExport(batch.id).then(
      (id) => {
        sessionStorage.setItem(jobKey(batch.id), id)
        setJobId(id)
      },
      (error: unknown) => setJob({ kind: 'failed', message: offerRefusal(error, false) }),
    )
  }

  if (!canExport) return null
  if (job?.kind === 'ready')
    return (
      <a className="df-button" href={job.url} download={fileName(batch)}>
        {fill(plural(words.download, job.rows), { count: formatCount(job.rows) })}
      </a>
    )
  return (
    <span className="df-offer-batch-file">
      <button type="button" className="df-button" disabled={sample || job?.kind === 'preparing'} onClick={ask}>
        {job?.kind === 'preparing' ? words.preparing : words.makeFile}
      </button>
      {job?.kind === 'failed' && <span className="df-offers-error" role="alert">{job.message}</span>}
    </span>
  )
}

export const CodeBatches = ({ offerId, sample, canEdit, canExport, canUpgrade }: { offerId: string; sample: CodeBatch[] | null; canEdit: boolean; canExport: boolean; canUpgrade: boolean }) => {
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [count, setCount] = useState('500')
  const [prefix, setPrefix] = useState('')
  const [length, setLength] = useState<number>(codeLengths[1])
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const [made, setMade] = useState<string | null>(null)
  const latest = useRef(0)

  const load = useCallback(() => {
    const mine = ++latest.current
    if (sample) return setView({ kind: 'ready', batches: sample, next: null, more: 'idle' })
    void loadCodeBatches(offerId).then(
      (page) => mine === latest.current && setView({ kind: 'ready', batches: page.rows, next: page.next, more: 'idle' }),
      () => mine === latest.current && setView({ kind: 'error' }),
    )
  }, [offerId, sample])
  useEffect(load, [load])

  const more = () => {
    if (view.kind !== 'ready' || !view.next) return
    const mine = latest.current
    const shown = view
    setView({ ...shown, more: 'loading' })
    void loadCodeBatches(offerId, shown.next).then(
      (page) => mine === latest.current && setView({ kind: 'ready', batches: [...shown.batches, ...page.rows], next: page.next, more: 'idle' }),
      () => mine === latest.current && setView({ ...shown, more: 'failed' }),
    )
  }

  const n = Number(count)
  const countOk = Number.isInteger(n) && n >= 1 && n <= codeBatchLimits.count
  const cleanPrefix = prefix.trim().toUpperCase()
  const prefixOk = codePrefixPattern.test(cleanPrefix)
  const make = () => {
    setProblem(null)
    setMade(null)
    if (!countOk) return setProblem(fill(words.countError, { max: formatCount(codeBatchLimits.count) }))
    if (!prefixOk) return setProblem(fill(words.prefixError, { max: String(codeBatchLimits.prefix) }))
    if (sample) return setMade(fill(plural(words.made, n), { count: formatCount(n) }))
    setBusy(true)
    void generateCodes(offerId, { count: n, prefix: cleanPrefix, length })
      .then(
        (batch) => {
          setMade(fill(plural(words.made, batch.count), { count: formatCount(batch.count) }))
          load()
        },
        (error: unknown) => setProblem(offerRefusal(error, canUpgrade)),
      )
      .finally(() => setBusy(false))
  }

  const sampleCodes = Array.from({ length: 3 }, (_, i) => `${cleanPrefix}${words.sampleChars.slice(i * 2, i * 2 + length)}`).join(words.sampleJoiner)
  return (
    <section className="df-offer-card" aria-labelledby="df-offer-codes">
      <div className="df-offer-card-head">
        <h2 id="df-offer-codes">{words.title}</h2>
      </div>
      {view.kind === 'loading' && <LoadingState label={words.loading} />}
      {view.kind === 'error' && <ErrorState title={words.error} body={messages.offers.error.body} retry={{ label: messages.offers.error.retry, onRetry: load }} />}
      {view.kind === 'ready' && view.batches.length === 0 && <p className="df-offers-sub">{words.none}</p>}
      {view.kind === 'ready' && view.batches.length > 0 && (
        <ul className="df-offer-batches">
          {view.batches.map((b) => (
            <li key={b.id}>
              <span>{fill(words.batch, { count: formatCount(b.count), used: formatCount(b.used), unused: formatCount(b.count - b.used), prefix: b.prefix || words.noPrefix })}</span>
              <BatchFile batch={b} sample={Boolean(sample)} canExport={canExport} />
            </li>
          ))}
        </ul>
      )}
      {view.kind === 'ready' && view.next && (
        <span className="df-offer-batch-file">
          <button type="button" className="df-button" disabled={view.more === 'loading'} onClick={more}>
            {view.more === 'loading' ? words.loadingMore : words.more}
          </button>
          {view.more === 'failed' && <span className="df-offers-error" role="alert">{words.moreFailed}</span>}
        </span>
      )}
      {canEdit && (
        <div className="df-offer-make">
          <div className="df-offer-make-fields">
            <label>
              <span>{words.count}</span>
              <input value={count} inputMode="numeric" onChange={(e) => setCount(e.target.value.replace(/\D/g, ''))} aria-invalid={!countOk || undefined} />
            </label>
            <label>
              <span>{words.prefix}</span>
              <input value={prefix} maxLength={codeBatchLimits.prefix} autoCapitalize="characters" onChange={(e) => setPrefix(e.target.value.toUpperCase().replace(/\s/g, ''))} aria-invalid={!prefixOk || undefined} />
            </label>
            <label>
              <span>{words.length}</span>
              <select value={length} onChange={(e) => setLength(Number(e.target.value))}>
                {codeLengths.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="df-offers-sub">{fill(words.sample, { codes: sampleCodes })}</p>
          <p className="df-offers-sub">{words.help}</p>
          <button type="button" className="df-button" disabled={busy} onClick={make}>
            {busy ? words.making : words.make}
          </button>
          <div role="status">
            {problem && <p className="df-offers-error">{problem}</p>}
            {made && <p className="df-offers-good">{made}</p>}
          </div>
        </div>
      )}
    </section>
  )
}
