import { useId, useState } from 'react'
import type { PhotoRefusal } from '../../api/storeCategorySample'
import { fill, messages } from '../../messages'
import type { DraftPhoto, DraftProduct } from './sampleDraft'
import '../partners/partners.css'
import './storeCategories.css'

const words = messages.storeCategories.editor

export interface SampleProductFieldsProps {
  value: DraftProduct
  collections: readonly string[]
  currency: string
  onChange: (value: DraftProduct) => void
  upload: (file: File) => Promise<{ ok: true; ref: string; previewUrl: string } | { ok: false; code: PhotoRefusal }>
}

/** The product dialog's fields; the photo goes up as soon as it's chosen and the product names it on Save. */
export const SampleProductFields = ({ value, collections, currency, onChange, upload }: SampleProductFieldsProps) => {
  const id = useId()
  const [uploading, setUploading] = useState(false)
  const [photoError, setPhotoError] = useState<string | null>(null)
  const set = (patch: Partial<DraftProduct>) => onChange({ ...value, ...patch })

  const choose = (file: File) => {
    setUploading(true)
    setPhotoError(null)
    void upload(file).then((r) => {
      setUploading(false)
      if (r.ok) set({ photo: { ref: r.ref, previewUrl: r.previewUrl } satisfies DraftPhoto })
      else setPhotoError(words.photoRefused[r.code])
    })
  }

  return (
    <>
      <div className="df-field">
        <label htmlFor={`${id}-name`}>{words.fields.name}</label>
        <input id={`${id}-name`} type="text" maxLength={255} required value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="df-field">
        <label htmlFor={`${id}-description`}>{words.fields.description}</label>
        <textarea id={`${id}-description`} rows={3} maxLength={5000} value={value.description} onChange={(e) => set({ description: e.target.value })} />
      </div>
      <div className="df-sample-row">
        <div className="df-field">
          <label htmlFor={`${id}-sku`}>{words.fields.sku}</label>
          <input id={`${id}-sku`} type="text" maxLength={64} required value={value.sku} onChange={(e) => set({ sku: e.target.value })} />
        </div>
        <div className="df-field">
          <label htmlFor={`${id}-price`}>{fill(words.fields.price, { currency })}</label>
          <input id={`${id}-price`} type="text" inputMode="decimal" required value={value.price} onChange={(e) => set({ price: e.target.value })} />
        </div>
        <div className="df-field">
          <label htmlFor={`${id}-stock`}>{words.fields.stock}</label>
          <input id={`${id}-stock`} type="text" inputMode="numeric" value={value.stock} onChange={(e) => set({ stock: e.target.value })} />
        </div>
      </div>
      <label className="df-sample-check">
        <input type="checkbox" checked={value.visible} onChange={(e) => set({ visible: e.target.checked })} />
        {words.fields.visible}
      </label>
      <fieldset className="df-choices">
        <legend>{words.fields.collections}</legend>
        {collections.map((c) => (
          <label key={c} className="df-sample-check">
            <input
              type="checkbox"
              checked={value.collections.includes(c)}
              onChange={(e) => set({ collections: e.target.checked ? [...value.collections, c] : value.collections.filter((x) => x !== c) })}
            />
            {c}
          </label>
        ))}
      </fieldset>
      <fieldset className="df-choices">
        <legend>{words.fields.photo}</legend>
        <div className="df-sample-photo-field">
          {value.photo?.previewUrl ? <img src={value.photo.previewUrl} alt={fill(words.photoAlt, { name: value.name || words.fields.name })} className="df-sample-thumb df-sample-thumb--large" /> : <span className="df-field-hint">{words.noPhoto}</span>}
          <label className="df-button df-button--small df-sample-upload" htmlFor={`${id}-photo`}>
            {uploading ? words.uploading : value.photo ? words.replacePhoto : words.uploadPhoto}
            <input
              id={`${id}-photo`}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="df-visually-hidden"
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) choose(file)
              }}
            />
          </label>
          {value.photo && (
            <button type="button" className="df-button df-button--small" onClick={() => set({ photo: null })}>
              {words.removePhoto}
            </button>
          )}
        </div>
        {photoError && (
          <p className="df-field-error" role="alert">
            {photoError}
          </p>
        )}
      </fieldset>
    </>
  )
}
