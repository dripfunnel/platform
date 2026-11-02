import { formatMoney, minorOf } from '@dripfunnel/shared/format'
import { useId, useRef, type ReactNode } from 'react'
import { fill, locale, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { productKinds, type Draft, type DraftProblem, type DraftVersion, type ProductKind } from '../common/productDraft'

const words = messages.editor

export type Update = (change: (draft: Draft) => Draft) => void

export const Card = ({ title, aside, children }: { title?: string; aside?: ReactNode; children: ReactNode }) => (
  <section className="df-editor-card">
    {(title || aside) && (
      <div className="df-editor-card-head">
        {title && <h2>{title}</h2>}
        {aside}
      </div>
    )}
    {children}
  </section>
)

/** "What are you selling?": the four kinds (FIRST-RELEASE §1); a supplier's are physical only (ACCESS §7.1). */
export const KindCard = ({ draft, disabled, supplier, onPick }: { draft: Draft; disabled: boolean; supplier: boolean; onPick: (kind: ProductKind) => void }) => (
  <Card title={words.kind.title}>
    <div className="df-editor-kinds" role="radiogroup" aria-label={words.kind.title}>
      {productKinds.map((kind) => (
        <button key={kind} type="button" role="radio" aria-checked={draft.kind === kind} className="df-editor-kind" disabled={disabled || (supplier && kind !== 'physical')} onClick={() => onPick(kind)}>
          <strong>{words.kind[kind]}</strong>
          <span>{words.kind[`${kind}Sub`]}</span>
        </button>
      ))}
    </div>
    {supplier && <p className="df-editor-hint">{words.kind.merchantOnly}</p>}
  </Card>
)

export interface PendingPhoto {
  id: string
  name: string
  state: 'uploading' | 'failed'
  message: string | null
}

export const maxPhotos = 20

/** Photos: the main one first, made main with a tap; uploads show while they run, and a failed one says why. */
export const PhotosCard = ({
  draft,
  update,
  disabled,
  pending,
  onFiles,
  onRetry,
  onDismiss,
}: {
  draft: Draft
  update: Update
  disabled: boolean
  pending: readonly PendingPhoto[]
  onFiles: (files: File[]) => void
  onRetry: (id: string) => void
  onDismiss: (id: string) => void
}) => {
  const input = useRef<HTMLInputElement>(null)
  const altId = useId()
  const own = draft.photos.filter((p) => p.versionChoices === null)
  // Versions' own photos count too: the API's limit is on every photo of the product.
  const count = draft.photos.length + pending.length
  const full = count >= maxPhotos
  const move = (assetId: string) => update((d) => ({ ...d, photos: [...d.photos.filter((p) => p.assetId === assetId), ...d.photos.filter((p) => p.assetId !== assetId)] }))
  const remove = (assetId: string) => update((d) => ({ ...d, photos: d.photos.filter((p) => p.assetId !== assetId) }))
  return (
    <Card title={words.photos.title} aside={<span className="df-editor-meter">{fill(words.photos.meter, { count: String(count), limit: String(maxPhotos) })}</span>}>
      <ul className="df-editor-photos">
        {own.map((photo, i) => (
          <li key={photo.assetId} className={i === 0 ? 'df-editor-photo df-editor-photo--main' : 'df-editor-photo'}>
            <AssetImage className="df-editor-photo-img" url={photo.url} alt={photo.alt} placeholder="" />
            {i === 0 && <span className="df-editor-photo-main">{words.photos.main}</span>}
            {!disabled && (
              <span className="df-editor-photo-actions">
                {i > 0 && (
                  <button type="button" aria-label={words.photos.makeMain} title={words.photos.makeMain} onClick={() => move(photo.assetId)}>
                    ★
                  </button>
                )}
                <button type="button" aria-label={fill(words.photos.remove, { name: photo.alt || String(i + 1) })} title={fill(words.photos.remove, { name: photo.alt || String(i + 1) })} onClick={() => remove(photo.assetId)}>
                  ×
                </button>
              </span>
            )}
          </li>
        ))}
        {pending.map((p) => (
          <li key={p.id} className="df-editor-photo df-editor-photo--pending" role="status">
            {p.state === 'uploading' ? (
              <span>{words.photos.uploading}</span>
            ) : (
              <span className="df-editor-photo-failed">
                <strong>{words.photos.failed}</strong>
                {p.message && <span>{p.message}</span>}
                <span>
                  <button type="button" onClick={() => onRetry(p.id)}>
                    {words.photos.retry}
                  </button>
                  <button type="button" onClick={() => onDismiss(p.id)}>
                    {words.photos.dismiss}
                  </button>
                </span>
              </span>
            )}
          </li>
        ))}
        {!disabled && !full && (
          <li>
            <button type="button" className="df-editor-photo-add" onClick={() => input.current?.click()}>
              <span aria-hidden="true">+</span>
              {count === 0 ? words.photos.add : words.photos.addMore}
            </button>
            <input
              ref={input}
              className="df-visually-hidden"
              type="file"
              accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
              multiple
              tabIndex={-1}
              aria-hidden="true"
              onChange={(event) => {
                onFiles([...(event.target.files ?? [])].slice(0, maxPhotos - count))
                event.target.value = ''
              }}
            />
          </li>
        )}
      </ul>
      {full && <p className="df-editor-hint">{words.photos.limit}</p>}
      {own[0] && (
        <div className="df-editor-field">
          <label htmlFor={altId}>
            {words.photos.altLabel} <span className="df-editor-hint-inline">{words.photos.altHint}</span>
          </label>
          <input id={altId} value={own[0].alt} maxLength={200} readOnly={disabled} onChange={(event) => update((d) => ({ ...d, photos: d.photos.map((p) => (p.assetId === own[0]?.assetId ? { ...p, alt: event.target.value } : p)) }))} />
        </div>
      )}
      <p className="df-editor-hint">{own.length > 0 ? words.photos.help : words.photos.helpNone}</p>
    </Card>
  )
}

const Problem = ({ id, text }: { id: string; text: string }) => (
  <span id={id} className="df-editor-problem">
    {text}
  </span>
)

/** The product's name and description. */
export const BasicsCard = ({ draft, update, disabled, problems }: { draft: Draft; update: Update; disabled: boolean; problems: readonly DraftProblem[] }) => {
  const nameId = useId()
  const descId = useId()
  const missing = problems.includes('name')
  return (
    <Card>
      <div className="df-editor-field">
        <label htmlFor={nameId}>{words.name.label}</label>
        <input id={nameId} value={draft.name} maxLength={255} readOnly={disabled} placeholder={words.name.placeholder} aria-invalid={missing} aria-describedby={missing ? `${nameId}-p` : undefined} onChange={(event) => update((d) => ({ ...d, name: event.target.value }))} />
        {missing && <Problem id={`${nameId}-p`} text={words.name.missing} />}
      </div>
      <div className="df-editor-field">
        <label htmlFor={descId}>
          {words.description.label} <span className="df-editor-hint-inline">{words.description.optional}</span>
        </label>
        <textarea id={descId} rows={4} value={draft.description} maxLength={20_000} readOnly={disabled} placeholder={words.description.placeholder} onChange={(event) => update((d) => ({ ...d, description: event.target.value }))} />
      </div>
    </Card>
  )
}

/** "1299.00" for a hint, in the currency's own decimals. */
export const exampleOf = (currency: string) => formatMoney({ amount: 129900, currency }, locale)

export type PriceKey = 'price' | 'compareAt' | 'cost'

/** Why a version's price, compare-at price or cost won't save, once a save was tried (`problems`); null when it will. */
export const priceProblemOf = (version: DraftVersion, key: PriceKey, currency: string, problems: readonly DraftProblem[]): string | null => {
  const price = minorOf(version.price, currency)
  const invalid = fill(words.price.invalid, { example: exampleOf(currency) })
  if (key === 'price') return problems.includes('price') && !(typeof price === 'number' && price > 0) ? (price === 'invalid' ? invalid : words.price.missing) : null
  if (key === 'compareAt') {
    const at = minorOf(version.compareAt, currency)
    return problems.includes('compare') && (at === 'invalid' || (typeof at === 'number' && typeof price === 'number' && at <= price)) ? words.price.compareLow : null
  }
  return problems.includes('cost') && minorOf(version.cost, currency) === 'invalid' ? invalid : null
}

const priceLabels: Record<PriceKey, { label: ReactNode; placeholder: string }> = {
  price: { label: words.price.price, placeholder: '0.00' },
  compareAt: { label: words.price.compare, placeholder: words.price.compareHint },
  cost: { label: <>{words.price.cost} <span className="df-editor-hint-inline">{words.price.costHint}</span></>, placeholder: words.price.costPlaceholder },
}

/** One money field of the Price card, also a version's and the bulk box's. */
export const PriceField = ({ id, field, value, currency, problem, readOnly, onChange }: { id: string; field: PriceKey; value: string; currency: string; problem: string | null; readOnly: boolean; onChange: (value: string) => void }) => (
  <div className="df-editor-field">
    <label htmlFor={id}>{priceLabels[field].label}</label>
    <span className="df-editor-money">
      <span aria-hidden="true">{currency}</span>
      <input id={id} inputMode="decimal" value={value} readOnly={readOnly} placeholder={priceLabels[field].placeholder} aria-invalid={problem !== null} aria-describedby={problem ? `${id}-p` : undefined} onChange={(event) => onChange(event.target.value)} />
    </span>
    {problem && <Problem id={`${id}-p`} text={problem} />}
  </div>
)

/** What each sale makes or loses, once a price and a cost are both typed. */
export const Profit = ({ version, currency }: { version: DraftVersion; currency: string }) => {
  const price = minorOf(version.price, currency)
  const cost = minorOf(version.cost, currency)
  if (!(typeof price === 'number' && price > 0 && typeof cost === 'number' && cost > 0)) return null
  const profit = price - cost
  const money = (amount: number) => formatMoney({ amount, currency }, locale)
  return <span className={profit >= 0 ? 'df-editor-profit' : 'df-editor-profit df-editor-profit--loss'}>{profit >= 0 ? fill(words.price.profit, { amount: money(profit), margin: String(Math.round((profit / price) * 100)) }) : fill(words.price.loss, { amount: money(-profit) })}</span>
}

/** Price, compare-at price and cost for a product without choices, with what the shopper pays and what it makes. */
export const PriceCard = ({ draft, update, disabled, currency, problems, inclusive, children }: { draft: Draft; update: Update; disabled: boolean; currency: string; problems: readonly DraftProblem[]; inclusive: boolean | null; children?: ReactNode }) => {
  const id = useId()
  const version = draft.versions[0]
  if (!version) return null
  const set = (patch: Partial<typeof version>) => update((d) => ({ ...d, versions: d.versions.map((v, i) => (i === 0 ? { ...v, ...patch } : v)) }))
  const price = minorOf(version.price, currency)
  const money = (amount: number) => formatMoney({ amount, currency }, locale)
  const shown = typeof price === 'number' && price > 0 ? price : null
  const breakdown = shown === null ? words.price.none : inclusive === false ? fill(words.price.added, { price: money(shown) }) : fill(words.price.included, { price: money(shown) })
  const field = (key: PriceKey) => <PriceField id={`${id}-${key}`} field={key} value={version[key]} currency={currency} problem={priceProblemOf(version, key, currency, problems)} readOnly={disabled} onChange={(value) => set({ [key]: value })} />
  return (
    <Card title={words.price.title}>
      <div className="df-editor-price">
        {field('price')}
        {field('compareAt')}
        {field('cost')}
      </div>
      <div className="df-editor-breakdown">
        <span>{breakdown}</span>
        <Profit version={version} currency={currency} />
      </div>
      <p className="df-editor-hint">{words.price.compareHelp}</p>
      {children}
    </Card>
  )
}
