import { useCallback, useEffect, useRef, useState } from 'react'
import { loadDeliveryApp, setMinimumBuild, uploadDeliveryApp, type DeliveryApp, type DeliveryAppAnswer } from '../../api/deliveryApp'
import type { Store } from '../../api/stores'
import { fill, formatCount, formatTime, messages } from '../../messages'
import { ErrorState, LoadingState } from '@dripfunnel/shared/ui'

const words = messages.store.deliveryApp

const megabytes = (bytes: number): string => fill(words.sizeMb, { size: formatCount(Math.round((bytes / (1024 * 1024)) * 10) / 10) })

export interface DeliveryAppTabProps {
  store: Store
  /** Whether this staff role may change it (stores.deliveryApp.write); the API decides, this only turns the controls off. */
  canChange: boolean
  onToast: (message: string) => void
}

type Loaded = { state: 'loading' } | { state: 'error' } | { state: 'ready'; current: DeliveryApp | null }

// Written inline, like Notes. Each change is a new version with the reason kept in the activity log (api/DELIVERY.md §5).
export const DeliveryAppTab = ({ store, canChange, onToast }: DeliveryAppTabProps) => {
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [busy, setBusy] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [versionName, setVersionName] = useState('')
  const [buildNumber, setBuildNumber] = useState('')
  const [uploadReason, setUploadReason] = useState('')
  const [minimum, setMinimum] = useState('')
  const [minimumReason, setMinimumReason] = useState('')
  const [problem, setProblem] = useState<string | null>(null)

  const latest = useRef(0)
  const load = useCallback(() => {
    const mine = ++latest.current
    setLoaded({ state: 'loading' })
    void loadDeliveryApp(store.id).then((answer) => {
      if (mine !== latest.current) return
      if (!answer.ok) return setLoaded({ state: 'error' })
      setLoaded({ state: 'ready', current: answer.current })
      setMinimum(answer.current?.minimumBuild?.toString() ?? '')
    })
  }, [store.id])
  useEffect(load, [load])

  const finish = (answer: DeliveryAppAnswer, done: string, reset: () => void) => {
    setBusy(false)
    if (!answer.ok) return setProblem(words.refusals[answer.code])
    setProblem(null)
    setLoaded({ state: 'ready', current: answer.current })
    setMinimum(answer.current?.minimumBuild?.toString() ?? '')
    reset()
    onToast(done)
  }

  const build = Number(buildNumber)
  const canUpload = canChange && !busy && file !== null && /^[0-9A-Za-z][0-9A-Za-z._+-]{0,39}$/.test(versionName) && Number.isInteger(build) && build >= 1 && uploadReason.trim() !== ''
  const upload = () => {
    if (!file) return
    setBusy(true)
    void uploadDeliveryApp(store.id, file, { versionName, buildNumber: build, reason: uploadReason.trim() }).then((answer) =>
      finish(answer, fill(words.uploaded, { version: versionName }), () => {
        setFile(null)
        setVersionName('')
        setBuildNumber('')
        setUploadReason('')
      }),
    )
  }

  const minimumValue = minimum.trim() === '' ? null : Number(minimum)
  const current = loaded.state === 'ready' ? loaded.current : null
  const canSetMinimum = canChange && !busy && current !== null && minimumReason.trim() !== '' && (minimumValue === null || (Number.isInteger(minimumValue) && minimumValue >= 1)) && minimumValue !== current.minimumBuild
  const saveMinimum = () => {
    setBusy(true)
    void setMinimumBuild(store.id, minimumValue, minimumReason.trim()).then((answer) => finish(answer, words.minimumSaved, () => setMinimumReason('')))
  }

  if (loaded.state === 'loading') return <LoadingState label={words.loading} rows={3} />
  if (loaded.state === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />

  return (
    <div className="df-panels">
      <section className="df-panel df-panel--wide" aria-labelledby="store-delivery-app">
        <div className="df-panel-head">
          <h2 id="store-delivery-app">{words.title}</h2>
          <span className="df-muted">{words.sub}</span>
        </div>
        {current ? (
          <dl className="df-facts">
            <dt>{words.version}</dt>
            <dd>{fill(words.versionValue, { name: current.versionName, build: formatCount(current.buildNumber) })}</dd>
            <dt>{words.size}</dt>
            <dd>{megabytes(current.sizeBytes)}</dd>
            <dt>{words.uploadedAt}</dt>
            <dd>{formatTime(current.uploadedAt)}</dd>
            <dt>{words.minimumBuild}</dt>
            <dd>{current.minimumBuild === null ? words.noMinimum : formatCount(current.minimumBuild)}</dd>
          </dl>
        ) : (
          <p className="df-muted">{words.none}</p>
        )}
        {problem && <p role="alert">{problem}</p>}
        {!canChange && <p className="df-muted">{words.readOnly}</p>}
      </section>

      <section className="df-panel df-panel--wide" aria-labelledby="store-delivery-app-upload">
        <div className="df-panel-head">
          <h2 id="store-delivery-app-upload">{current ? words.replaceTitle : words.uploadTitle}</h2>
          <span className="df-muted">{words.uploadSub}</span>
        </div>
        <div className="df-field">
          <label>
            {words.file}
            <input type="file" accept=".apk,application/vnd.android.package-archive" disabled={!canChange || busy} onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </label>
          <label>
            {words.versionName}
            <input value={versionName} maxLength={40} disabled={!canChange || busy} onChange={(event) => setVersionName(event.target.value)} />
          </label>
          <label>
            {words.buildNumber}
            <input inputMode="numeric" value={buildNumber} disabled={!canChange || busy} onChange={(event) => setBuildNumber(event.target.value)} />
          </label>
          {current && <span className="df-muted">{fill(words.buildHint, { build: formatCount(current.buildNumber) })}</span>}
          <label>
            {words.reason}
            <textarea rows={2} maxLength={500} placeholder={words.reasonHint} disabled={!canChange || busy} value={uploadReason} onChange={(event) => setUploadReason(event.target.value)} />
          </label>
          <button type="button" className="df-button df-button--primary" disabled={!canUpload} onClick={upload}>
            {busy ? words.uploading : words.upload}
          </button>
        </div>
      </section>

      {current && (
        <section className="df-panel df-panel--wide" aria-labelledby="store-delivery-app-minimum">
          <div className="df-panel-head">
            <h2 id="store-delivery-app-minimum">{words.minimumTitle}</h2>
            <span className="df-muted">{words.minimumSub}</span>
          </div>
          <div className="df-field">
            <label>
              {words.minimumBuild}
              <input inputMode="numeric" placeholder={words.noMinimum} value={minimum} disabled={!canChange || busy} onChange={(event) => setMinimum(event.target.value)} />
            </label>
            <span className="df-muted">{fill(words.minimumHint, { build: formatCount(current.buildNumber) })}</span>
            <label>
              {words.reason}
              <textarea rows={2} maxLength={500} placeholder={words.reasonHint} disabled={!canChange || busy} value={minimumReason} onChange={(event) => setMinimumReason(event.target.value)} />
            </label>
            <button type="button" className="df-button df-button--primary" disabled={!canSetMinimum} onClick={saveMinimum}>
              {words.saveMinimum}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
