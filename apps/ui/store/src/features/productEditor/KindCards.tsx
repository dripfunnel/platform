import { minorOf, moneyDigits } from '@dripfunnel/shared/format'
import { useId, useRef, useState, type ReactNode } from 'react'
import { downloadDays, downloadLimits, giftCardMonths, maxDownloadBytes, maxKeyLength, maxKeysPerSave, maxServiceDuration, maxServiceLocation, uploadDownload, type DownloadFile } from '../../api/productKinds'
import { fill, formatCount, locale, messages, plural } from '../../messages'
import { keysOf, type KindDetails, type KindProblem } from '../common/kindDetails'
import { amountsOf, withAmounts, type Draft, type DraftProblem } from '../common/productDraft'
import type { Ask } from './ChoicesCard'
import { Card, exampleOf, type Update } from './EditorCards'

// The kinds' own cards (CatEditor "What the shopper gets", "About the service", "Gift card amounts"; CATALOG T14).

const words = messages.editor.kinds

const setDetails = (update: Update, change: (d: KindDetails) => KindDetails) => update((d) => ({ ...d, details: change(d.details) }))

export const megabytes = (bytes: number) => fill(words.download.megabytes, { size: formatCount(Math.round((bytes / 1024 / 1024) * 10) / 10) })

const typeOf = (mime: string) => {
  const types: Record<string, string> = words.download.types
  return types[mime] ?? (mime.startsWith('image/') ? words.download.types.image : words.download.types.other)
}

/** "PDF file · 18 MB": the API keeps the file's type and size, never its name. */
export const fileMeta = (file: DownloadFile) => fill(words.download.fileMeta, { type: typeOf(file.mime), size: megabytes(file.bytes) })

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
      if (!result.ok) return setRefusal(fill(words.download.refused[result.code], { size: megabytes(maxDownloadBytes) }))
      set({ file: result.file })
    })
  }
  const missing = problems.includes('file') && !uploading
  const left = pool?.left ?? 0

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
              <span>{fill(words.download.uploadHint, { size: megabytes(maxDownloadBytes) })}</span>
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
          <p className={pool && left < 5 ? 'df-editor-pool df-editor-pool--low' : 'df-editor-pool'}>
            {pool && left === 0 ? words.download.keysNone : fill(plural(words.download.keysLeft, left), { count: formatCount(left) })}
            {pool && left > 0 && left < 5 && ` · ${words.download.keysLow}`}
            {pool && pool.sold > 0 && ` · ${fill(plural(words.download.keysSold, pool.sold), { count: formatCount(pool.sold) })}`}
          </p>
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

/** "₹500", or "$12.50": an amount as its chip and its choice name show it. */
export const amountLabel = (amount: number, currency: string) => {
  const digits = moneyDigits(currency)
  const whole = amount % 10 ** digits === 0
  return new Intl.NumberFormat(locale, { style: 'currency', currency, ...(whole ? { minimumFractionDigits: 0, maximumFractionDigits: 0 } : {}) }).format(amount / 10 ** digits)
}

const periods: Record<string, string | undefined> = words.giftCard.months
const periodOf = (months: number) => periods[String(months)] ?? formatCount(months)

/** A gift card: its amounts (its versions), when its cards expire, and the cards issued, given after it. */
export const GiftCardCard = ({ draft, update, disabled, currency, problems, shortestMonths, ask, onToast, children }: { draft: Draft; update: Update; disabled: boolean; currency: string; problems: readonly DraftProblem[]; shortestMonths: number | null; ask: Ask; onToast: (text: string) => void; children?: ReactNode }) => {
  const id = useId()
  const amounts = amountsOf(draft, currency)
  const setAmounts = (next: number[]) => update((d) => withAmounts(d, next, currency, words.giftCard.option, (a) => amountLabel(a, currency)))
  const remove = (amount: number) => (amounts.length <= 1 ? onToast(words.giftCard.keepOne) : setAmounts(amounts.filter((a) => a !== amount)))
  const add = () =>
    ask({
      title: words.giftCard.addTitle,
      target: draft.name.trim() || words.giftCard.title,
      consequence: '',
      confirmLabel: words.giftCard.addConfirm,
      input: {
        label: fill(words.giftCard.addLabel, { currency }),
        type: 'text',
        initial: '',
        error: (value) => {
          const minor = minorOf(value, currency)
          if (typeof minor !== 'number' || minor <= 0) return fill(words.giftCard.addInvalid, { example: exampleOf(currency) })
          return amounts.includes(minor) ? words.giftCard.addTaken : null
        },
      },
      onConfirm: (_, value) => {
        const minor = minorOf(value ?? '', currency)
        if (typeof minor === 'number') setAmounts([...amounts, minor])
      },
    })
  const expiry = draft.details.giftCard.expiryMonths
  const offered = giftCardMonths.filter((m) => shortestMonths === null || m >= shortestMonths)
  return (
    <Card title={words.giftCard.title}>
      <div className="df-editor-values">
        {amounts.map((amount) => (
          <span key={amount} className="df-editor-value">
            {amountLabel(amount, currency)}
            {!disabled && (
              <button type="button" aria-label={fill(words.giftCard.remove, { amount: amountLabel(amount, currency) })} onClick={() => remove(amount)}>
                ×
              </button>
            )}
          </span>
        ))}
        {!disabled && (
          <button type="button" className="df-editor-chip df-editor-chip--add" onClick={add}>
            {words.giftCard.add}
          </button>
        )}
      </div>
      {problems.includes('price') && amounts.length === 0 && <span className="df-editor-problem">{words.giftCard.missing}</span>}
      <div className="df-editor-field df-editor-narrow">
        <label htmlFor={`${id}-x`}>{words.giftCard.expiry}</label>
        <select id={`${id}-x`} value={expiry ?? 'never'} disabled={disabled} aria-describedby={`${id}-xr`} onChange={(event) => setDetails(update, (d) => ({ ...d, giftCard: { expiryMonths: event.target.value === 'never' ? null : Number(event.target.value) } }))}>
          {offered.map((m) => (
            <option key={m} value={m}>
              {m === shortestMonths ? fill(words.giftCard.shortest, { period: periodOf(m) }) : periodOf(m)}
            </option>
          ))}
          {expiry !== null && !offered.some((m) => m === expiry) && <option value={expiry}>{periodOf(expiry)}</option>}
          <option value="never">{words.giftCard.never}</option>
        </select>
        <span id={`${id}-xr`} className="df-editor-hint">
          {shortestMonths === null ? words.giftCard.ruleUnknown : fill(words.giftCard.rule, { period: periodOf(shortestMonths) })}
        </span>
      </div>
      <p className="df-editor-hint">{words.giftCard.tax}</p>
      {children}
    </Card>
  )
}
