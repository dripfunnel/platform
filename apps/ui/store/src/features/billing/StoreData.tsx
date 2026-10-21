import { readExportJob, type ExportJob } from '@dripfunnel/shared/graphql'
import { usePolling } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { exportStoreData, loadStoreDataExport, storeDataKinds, type StoreDataPart } from '../../api/billing'
import { fill, formatCount, messages, plural } from '../../messages'
import { refusalIn } from '../common/refusal'

const words = messages.billing.data
const refused = refusalIn(messages.billing.refused)

// The job's id outlives a reload, per store, so "Download my data" picks up where it was (the parts are kept an hour).
const storageKey = (storeId: string) => `df-store-data-export:${storeId}`
const pollMs = 3000

const remembered = (storeId: string): string | null => {
  try {
    return sessionStorage.getItem(storageKey(storeId))
  } catch {
    return null
  }
}

const remember = (storeId: string, id: string | null) => {
  try {
    if (id) sessionStorage.setItem(storageKey(storeId), id)
    else sessionStorage.removeItem(storageKey(storeId))
  } catch {
    // A browser that keeps nothing still shows the export until the page is left.
  }
}

const sampleParts: StoreDataPart[] = storeDataKinds.map((kind, i) => ({ id: `d${i}`, kind, state: 'done', rows: 3, truncated: false, csv: 'name\na\nb\nc\n', expiresAt: null }))

export interface StoreDataExport {
  parts: { kind: StoreDataPart['kind']; job: ExportJob }[] | null
  preparing: boolean
  error: string | null
  start: () => void
}

/** "Download my data first" (FIRST-RELEASE §16): `exportStoreData`'s three parts, read back until each is settled. */
export const useStoreDataExport = (sample: boolean, storeId: string): StoreDataExport => {
  const [id, setId] = useState<string | null>(() => (sample ? null : remembered(storeId)))
  const [sampled, setSampled] = useState<StoreDataPart[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [settled, setSettled] = useState(false)
  const read = useCallback(() => (id ? loadStoreDataExport(id) : Promise.resolve([])), [id])
  const { value } = usePolling(id && !settled ? read : null, pollMs)
  // Every part done, failed or expired: nothing more to wait for. A job the API no longer knows (gone after its hour) is forgotten.
  useEffect(() => {
    if (!value) return
    if (value.length === 0) {
      remember(storeId, null)
      setId(null)
    }
    if (value.every((p) => p.state !== 'queued')) setSettled(true)
  }, [value, storeId])
  const raw = sampled ?? value
  const parts = useMemo(() => (raw && raw.length > 0 ? raw.map((p) => ({ kind: p.kind, job: readExportJob(p) ?? { id: p.id, state: 'failed' as const, entries: null, url: null, expiresAt: null } })) : null), [raw])
  const preparing = starting || (id !== null && !settled)

  const start = () => {
    setError(null)
    if (sample) return setSampled(sampleParts)
    setStarting(true)
    exportStoreData()
      .then((next) => {
        remember(storeId, next)
        setSettled(false)
        setId(next)
      })
      .catch((e: unknown) => setError(refused(e)))
      .finally(() => setStarting(false))
  }

  return { parts: id || sampled ? parts : null, preparing, error, start }
}

const partText = (job: ExportJob): string => {
  if (job.state === 'preparing') return words.waiting
  if (job.state === 'failed' || job.state === 'tooLarge') return words.failed
  if (job.state === 'expired') return words.expired
  const count = job.entries ?? 0
  return job.truncated ? fill(words.truncated, { count: formatCount(count) }) : fill(plural(words.rows, count), { count: formatCount(count) })
}

export const StoreDataPanel = ({ data }: { data: StoreDataExport }) => {
  if (!data.parts && !data.preparing && !data.error) return null
  return (
    <section className="df-billing-card" aria-labelledby="df-billing-data" aria-busy={data.preparing}>
      <h2 id="df-billing-data">{words.title}</h2>
      {data.error && (
        <p className="df-billing-refusal" role="alert">
          {data.error}
        </p>
      )}
      {data.preparing && <p className="df-billing-note">{words.preparing}</p>}
      {data.parts && (
        <ul className="df-billing-data">
          {data.parts.map(({ kind, job }) => (
            <li key={kind}>
              <span>
                <strong>{words.kinds[kind]}</strong> · {partText(job)}
              </span>
              {job.url && (
                <a className="df-billing-link" href={job.url} download={fill(words.file, { kind })}>
                  {words.download}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}
      {!data.preparing && data.parts?.some((p) => p.job.state !== 'ready') && (
        <button type="button" className="df-billing-link" onClick={data.start}>
          {words.again}
        </button>
      )}
    </section>
  )
}
