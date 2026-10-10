import { useId, useRef, useState } from 'react'
import { downloadDays, downloadLimits, maxDownloadBytes, maxKeyLength, maxKeysPerSave, maxServiceDuration, maxServiceLocation, uploadDownload, type DownloadFile } from '../../api/productKinds'
import { fill, formatCount, formatMegabytes, messages, plural } from '../../messages'
import { keysOf, type KindDetails, type KindProblem } from '../common/kindDetails'
import type { Draft } from '../common/productDraft'
import { Card, type Update } from './EditorCards'

// The kinds' own cards (CatEditor "What the shopper gets", "About the service"; CATALOG T14).

const words = messages.editor.kinds

const setDetails = (update: Update, change: (d: KindDetails) => KindDetails) => update((d) => ({ ...d, details: change(d.details) }))

const typeOf = (mime: string) => {
  const types: Record<string, string> = words.download.types
  return types[mime] ?? (mime.startsWith('image/') ? words.download.types.image : words.download.types.other)
}

/** "PDF file · 18 MB": the API keeps the file's type and size, never its name. */
export const fileMeta = (file: DownloadFile) => fill(words.download.fileMeta, { type: typeOf(file.mime), size: formatMegabytes(file.bytes) })

/** A download: a private file or a licence-key pool, and how often and how long its link works. */
export const DownloadCard = ({ draft, update, disabled, problems, pool }: { draft: Draft; update: Update; disabled: boolean; problems: readonly KindProblem[]; pool: { left: number; sold: number } | null }) => {
  const input = useRef<HTMLInputElement>(null)
  const latest = useRef(0)
  const [uploading, setUploading] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)
  const id = useId()
  const { download, keys } = draft.details
  const typed = keysOf(keys)
  const set = (patch: Partial<KindDetails['download']>) => setDetails(update, (d) => ({ ...d, download: { ...d.download, ...patch } }))

  const upload = (file: File) => {
    const mine = ++latest.current
    setUploading(true)
    setRefusal(null)
    void uploadDownload(file).then((result) => {
      // A later choice of file wins over an earlier upload still on its way.
      if (mine !== latest.current) return
      setUploading(false)
      if (!result.ok) return setRefusal(fill(words.download.refused[result.code], { size: formatMegabytes(maxDownloadBytes) }))
      set({ file: result.file })
    })
  }
  const missing = problems.includes('file') && !uploading

  return (
    <Card title={words.download.title}>
      <div className="df-editor-chips" role="radiogroup" aria-label={words.download.title}>
        {(['file', 'keys'] as const).map((mode) => (
          <button key={mode} type="button" role="radio" aria-checked={download.mode === mode} className="df-editor-chip df-editor-mode" disabled={disabled} onClick={() => set({ mode })}>
            {words.download[mode]}
          </button>
        ))}
      </div>
      {download.mode === 'file' ? (
        <>
          {download.file ? (
            <div className="df-editor-file">
              <strong>{fileMeta(download.file)}</strong>
              {!disabled && (
                <button type="button" className="df-button" disabled={uploading} onClick={() => input.current?.click()}>
                  {uploading ? words.download.uploading : words.download.replace}
                </button>
              )}
            </div>
          ) : (
            <button type="button" className="df-editor-drop" disabled={disabled || uploading} aria-describedby={missing ? `${id}-p` : undefined} onClick={() => input.current?.click()}>
              <strong>{uploading ? words.download.uploading : words.download.upload}</strong>
              <span>{fill(words.download.uploadHint, { size: formatMegabytes(maxDownloadBytes) })}</span>
            </button>
          )}
          <input
            ref={input}
            className="df-visually-hidden"
            type="file"
            accept="application/pdf,application/zip,audio/mpeg,video/mp4,video/webm,image/*"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) upload(file)
            }}
          />
          {refusal && (
            <span className="df-editor-problem" role="alert">
              {refusal}
            </span>
          )}
          {missing && !refusal && (
            <span id={`${id}-p`} className="df-editor-problem">
              {words.download.missing}
            </span>
          )}
          <div className="df-editor-two">
            <div className="df-editor-field">
              <label htmlFor={`${id}-limit`}>{words.download.limit}</label>
              <select id={`${id}-limit`} value={download.limit} disabled={disabled} onChange={(event) => set({ limit: Number(event.target.value) })}>
                {downloadLimits.map((n) => (
                  <option key={n} value={n}>
                    {formatCount(n)}
                  </option>
                ))}
              </select>
            </div>
            <div className="df-editor-field">
              <label htmlFor={`${id}-days`}>{words.download.days}</label>
              <select id={`${id}-days`} value={download.days} disabled={disabled} onChange={(event) => set({ days: Number(event.target.value) })}>
                {downloadDays.map((n) => (
                  <option key={n} value={n}>
                    {words.download.dayOptions[String(n) as `${typeof n}`]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <p className="df-editor-hint">{words.download.rule}</p>
        </>
      ) : (
        <>
          {pool && (
            <p className={pool.left < 5 ? 'df-editor-pool df-editor-pool--low' : 'df-editor-pool'}>
              {pool.left === 0 ? words.download.keysNone : fill(plural(words.download.keysLeft, pool.left), { count: formatCount(pool.left) })}
              {pool.left > 0 && pool.left < 5 && ` · ${words.download.keysLow}`}
              {pool.sold > 0 && ` · ${fill(plural(words.download.keysSold, pool.sold), { count: formatCount(pool.sold) })}`}
            </p>
          )}
          {!disabled && (
            <div className="df-editor-field">
              <label htmlFor={`${id}-keys`}>{words.download.keysLabel}</label>
              <textarea
                id={`${id}-keys`}
                className="df-editor-keys"
                rows={4}
                value={keys}
                placeholder={words.download.keysPlaceholder}
                spellCheck={false}
                autoComplete="off"
                aria-invalid={problems.includes('keys')}
                aria-describedby={`${id}-kh`}
                onChange={(event) => setDetails(update, (d) => ({ ...d, keys: event.target.value }))}
              />
              <span id={`${id}-kh`} className={problems.includes('keys') ? 'df-editor-problem' : 'df-editor-hint'}>
                {problems.includes('keys') ? fill(words.download.keysInvalid, { max: formatCount(maxKeysPerSave), length: formatCount(maxKeyLength) }) : typed.length > 0 ? fill(plural(words.download.keysTyped, typed.length), { count: formatCount(typed.length) }) : words.download.keysHint}
              </span>
            </div>
          )}
        </>
      )}
    </Card>
  )
}

/** A service: how long it takes and where, both optional; no booking. */
export const ServiceCard = ({ draft, update, disabled }: { draft: Draft; update: Update; disabled: boolean }) => {
  const id = useId()
  const { service } = draft.details
  const set = (patch: Partial<KindDetails['service']>) => setDetails(update, (d) => ({ ...d, service: { ...d.service, ...patch } }))
  return (
    <Card title={words.service.title}>
      <div className="df-editor-two">
        <div className="df-editor-field">
          <label htmlFor={`${id}-d`}>
            {words.service.duration} <span className="df-editor-hint-inline">{words.service.optional}</span>
          </label>
          <input id={`${id}-d`} value={service.duration} maxLength={maxServiceDuration} readOnly={disabled} placeholder={words.service.durationPlaceholder} onChange={(event) => set({ duration: event.target.value })} />
        </div>
        <div className="df-editor-field">
          <label htmlFor={`${id}-l`}>
            {words.service.location} <span className="df-editor-hint-inline">{words.service.optional}</span>
          </label>
          <input id={`${id}-l`} value={service.location} maxLength={maxServiceLocation} readOnly={disabled} placeholder={words.service.locationPlaceholder} onChange={(event) => set({ location: event.target.value })} />
        </div>
      </div>
      <p className="df-editor-note">{words.service.note}</p>
    </Card>
  )
}
