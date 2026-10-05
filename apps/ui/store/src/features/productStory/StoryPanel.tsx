import { useId, useRef, useState } from 'react'
import { uploadPhoto } from '../../api/productEditor'
import type { StoryGap } from '../../api/story'
import { fill, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { ProductSearch } from '../common/ProductSearch'
import { maxBoxItems, maxCompared, maxFeatures, maxGallery, type DraftModule, type DraftPhoto } from './storyDraft'

const words = messages.story
const panel = words.panel

export type ModuleChange = (change: (m: DraftModule) => DraftModule) => void

const gapText = (gaps: readonly StoryGap[], field: string) => (gaps.some((g) => g.field === field) ? ((words.gapFields as Record<string, string>)[field] ?? null) : null)

const Problem = ({ text }: { text: string | null }) => (text ? <span className="df-story-problem">{text}</span> : null)

/** A photo uploaded, shown, described (required to publish, Q7) and removed. */
const PhotoField = ({ photo, label, onChange, disabled, altPlaceholder, gaps }: { photo: DraftPhoto; label: string; onChange: (p: DraftPhoto) => void; disabled: boolean; altPlaceholder: string; gaps: readonly StoryGap[] }) => {
  const input = useRef<HTMLInputElement>(null)
  const altId = useId()
  const [busy, setBusy] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const pick = async (file: File | undefined) => {
    if (!file) return
    setBusy(true)
    setRefused(null)
    const result = await uploadPhoto(file)
    setBusy(false)
    if (result.ok) onChange({ ...photo, assetId: result.assetId })
    else setRefused(messages.editor.photos.refused[result.code])
  }
  return (
    <div className="df-story-photo">
      <span className="df-story-label">{label}</span>
      {photo.assetId ? <AssetImage className="df-story-photo-img" url={`/api/assets/${photo.assetId}`} alt={photo.alt} placeholder="" /> : null}
      {!disabled && (
        <span className="df-story-row">
          <button type="button" className="df-button" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? messages.editor.photos.uploading : photo.assetId ? panel.photoReplace : panel.photoAdd}
          </button>
          {photo.assetId && (
            <button type="button" className="df-story-link" onClick={() => onChange({ assetId: null, alt: '' })}>
              {panel.photoRemove}
            </button>
          )}
          <input
            ref={input}
            className="df-visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(e) => {
              void pick(e.target.files?.[0])
              e.target.value = ''
            }}
          />
        </span>
      )}
      <Problem text={refused ?? gapText(gaps, 'photo')} />
      {photo.assetId && (
        <>
          <label htmlFor={altId}>
            {panel.alt} <span className="df-story-hint">{panel.altHint}</span>
          </label>
          <input id={altId} maxLength={250} placeholder={altPlaceholder} value={photo.alt} readOnly={disabled} aria-invalid={gaps.some((g) => g.field === 'alt') && !photo.alt.trim()} onChange={(e) => onChange({ ...photo, alt: e.target.value })} />
          <Problem text={!photo.alt.trim() ? gapText(gaps, 'alt') : null} />
        </>
      )}
    </div>
  )
}

/** The selected module's fields, by its kind (CatAPlus's right panel). */
export const StoryPanel = ({
  module: m,
  change,
  disabled,
  gaps,
  productName,
  productId,
  blocks,
  supplier,
  names,
  onNamed,
}: {
  module: DraftModule
  change: ModuleChange
  disabled: boolean
  gaps: readonly StoryGap[]
  productName: string
  productId: string
  blocks: readonly { id: string; name: string }[] | 'failed'
  supplier: boolean
  names: Readonly<Record<string, string>>
  onNamed: (product: { id: string; name: string }) => void
}) => {
  const titleId = useId()
  const bodyId = useId()
  const set = (patch: Partial<DraftModule>) => change((x) => ({ ...x, ...patch }))
  const size = (words.sizes as Record<string, string>)[m.kind]
  const altPlaceholder = fill(panel.altPlaceholder, { name: productName })
  const placeholder = (words.placeholders as Record<string, string>)[m.kind] ?? panel.titlePlaceholder
  return (
    <aside className="df-story-panel" aria-label={words.kinds[m.kind]}>
      <h2>{words.kinds[m.kind]}</h2>
      {m.kind !== 'brand' && (
        <div className="df-story-field">
          <label htmlFor={titleId}>{panel.title}</label>
          <input id={titleId} maxLength={120} placeholder={placeholder} value={m.title} readOnly={disabled} onChange={(e) => set({ title: e.target.value })} />
          <Problem text={!m.title.trim() ? gapText(gaps, 'title') : null} />
        </div>
      )}
      {m.kind === 'imageText' && (
        <>
          <div className="df-story-field">
            <label htmlFor={bodyId}>{panel.body}</label>
            <textarea id={bodyId} rows={4} maxLength={1000} placeholder={panel.bodyPlaceholder} value={m.body} readOnly={disabled} onChange={(e) => set({ body: e.target.value })} />
            <Problem text={!m.body.trim() ? gapText(gaps, 'body') : null} />
          </div>
          <div className="df-story-row" role="radiogroup" aria-label={panel.side}>
            <span className="df-story-label">{panel.side}</span>
            {(['left', 'right'] as const).map((side) => (
              <button key={side} type="button" role="radio" aria-checked={m.side === side} className="df-story-chip" disabled={disabled} onClick={() => set({ side })}>
                {panel[side]}
              </button>
            ))}
          </div>
        </>
      )}
      {(m.kind === 'banner' || m.kind === 'imageText') && <PhotoField photo={m.photo} label={fill(panel.photo, { size: size ?? '' })} onChange={(photo) => set({ photo })} disabled={disabled} altPlaceholder={altPlaceholder} gaps={gaps} />}
      {m.kind === 'features' && (
        <div className="df-story-list">
          {m.items.map((item, i) => {
            const setItem = (patch: Partial<typeof item>) => set({ items: m.items.map((x, j) => (j === i ? { ...x, ...patch } : x)) })
            return (
              <div key={i} className="df-story-item">
                <input aria-label={fill(panel.itemTitle, { n: String(i + 1) })} maxLength={80} placeholder={words.placeholders.item} value={item.title} readOnly={disabled} onChange={(e) => setItem({ title: e.target.value })} />
                <input aria-label={`${panel.itemText} ${i + 1}`} maxLength={300} placeholder={panel.itemText} value={item.text} readOnly={disabled} onChange={(e) => setItem({ text: e.target.value })} />
                <PhotoField photo={item.photo} label={fill(panel.photo, { size: size ?? '' })} onChange={(photo) => setItem({ photo })} disabled={disabled} altPlaceholder={altPlaceholder} gaps={[]} />
                {!disabled && (
                  <button type="button" className="df-story-link" onClick={() => set({ items: m.items.filter((_, j) => j !== i) })}>
                    {fill(panel.itemRemove, { n: String(i + 1) })}
                  </button>
                )}
              </div>
            )
          })}
          {!disabled && m.items.length < maxFeatures && (
            <button type="button" className="df-story-link" onClick={() => set({ items: [...m.items, { title: '', text: '', photo: { assetId: null, alt: '' } }] })}>
              {panel.itemAdd}
            </button>
          )}
          <Problem text={gapText(gaps, 'items')} />
        </div>
      )}
      {m.kind === 'box' && (
        <div className="df-story-list">
          {m.items.map((item, i) => (
            <span key={i} className="df-story-row">
              <input aria-label={fill(panel.boxItem, { n: String(i + 1) })} maxLength={80} value={item.title} readOnly={disabled} onChange={(e) => set({ items: m.items.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} />
              {!disabled && (
                <button type="button" className="df-story-link" aria-label={fill(panel.boxRemove, { n: String(i + 1) })} onClick={() => set({ items: m.items.filter((_, j) => j !== i) })}>
                  <span aria-hidden="true">×</span>
                </button>
              )}
            </span>
          ))}
          {!disabled && m.items.length < maxBoxItems && (
            <button type="button" className="df-story-link" onClick={() => set({ items: [...m.items, { title: '', text: '', photo: { assetId: null, alt: '' } }] })}>
              {panel.boxAdd}
            </button>
          )}
          <Problem text={gapText(gaps, 'items')} />
        </div>
      )}
      {m.kind === 'gallery' && (
        <div className="df-story-list">
          <span className="df-story-label">{panel.gallery}</span>
          {m.photos.map((photo, i) => (
            <div key={i} className="df-story-item">
              <PhotoField photo={photo} label={fill(panel.galleryAlt, { n: String(i + 1) })} onChange={(p) => set({ photos: p.assetId ? m.photos.map((x, j) => (j === i ? p : x)) : m.photos.filter((_, j) => j !== i) })} disabled={disabled} altPlaceholder={altPlaceholder} gaps={gaps} />
            </div>
          ))}
          {!disabled && m.photos.length < maxGallery && (
            <PhotoField photo={{ assetId: null, alt: '' }} label={panel.galleryAdd} onChange={(p) => p.assetId && set({ photos: [...m.photos, p] })} disabled={disabled} altPlaceholder={altPlaceholder} gaps={m.photos.length === 0 ? gaps : []} />
          )}
        </div>
      )}
      {m.kind === 'compare' && (
        <div className="df-story-list">
          <span className="df-story-label">{panel.compare}</span>
          <span className="df-story-row">
            {m.productIds.map((id) => (
              <span key={id} className="df-story-chip">
                {names[id] ?? panel.compareGone}
                {!disabled && (
                  <button type="button" aria-label={fill(panel.compareRemove, { name: names[id] ?? panel.compareGone })} onClick={() => set({ productIds: m.productIds.filter((x) => x !== id) })}>
                    <span aria-hidden="true">×</span>
                  </button>
                )}
              </span>
            ))}
          </span>
          {!disabled && m.productIds.length < maxCompared && (
            <ProductSearch
              label={panel.compareSearch}
              hide={[...m.productIds, productId]}
              onPick={(p) => {
                onNamed(p)
                set({ productIds: [...m.productIds, p.id] })
              }}
            />
          )}
          <p className="df-story-hint">{panel.compareNote}</p>
          <Problem text={gapText(gaps, 'products')} />
        </div>
      )}
      {m.kind === 'brand' &&
        (supplier ? (
          <p className="df-story-hint">{panel.brandSupplier}</p>
        ) : blocks === 'failed' ? (
          <p className="df-story-problem">{panel.brandFailed}</p>
        ) : blocks.length === 0 ? (
          <p className="df-story-hint">{panel.brandEmpty}</p>
        ) : (
          <div className="df-story-field">
            <label htmlFor={bodyId}>{panel.brand}</label>
            <select id={bodyId} value={m.blockId ?? ''} disabled={disabled} onChange={(e) => set({ blockId: e.target.value || null })}>
              <option value="">{panel.brandNone}</option>
              {blocks.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
            <Problem text={gapText(gaps, 'block')} />
          </div>
        ))}
      {(m.kind === 'specs' || m.kind === 'faq') && <p className="df-story-hint">{fill(panel.fromProduct, { what: m.kind === 'specs' ? panel.fromSpecs : panel.fromFaqs })}</p>}
      {m.kind === 'video' && (
        <div className="df-story-field">
          <label htmlFor={bodyId}>{panel.video}</label>
          <input id={bodyId} type="url" maxLength={500} placeholder={panel.videoPlaceholder} value={m.videoUrl} readOnly={disabled} onChange={(e) => set({ videoUrl: e.target.value })} />
          <span className="df-story-hint">{panel.videoHint}</span>
          <Problem text={gapText(gaps, 'video')} />
        </div>
      )}
    </aside>
  )
}
