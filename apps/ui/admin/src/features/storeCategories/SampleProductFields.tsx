import { RichTextField } from '@dripfunnel/shared/ui'
import { useId } from 'react'
import { fill, messages } from '../../messages'
import type { DraftProduct } from './sampleDraft'
import { type SamplePhotoUpload } from './SamplePhotoField'
import { SamplePhotosField } from './SamplePhotosField'
import '../partners/partners.css'
import './storeCategories.css'

const words = messages.storeCategories.editor

export interface SampleProductFieldsProps {
  value: DraftProduct
  collections: readonly string[]
  currency: string
  onChange: (value: DraftProduct) => void
  upload: SamplePhotoUpload
}

/** The product dialog's fields. */
export const SampleProductFields = ({ value, collections, currency, onChange, upload }: SampleProductFieldsProps) => {
  const id = useId()
  const set = (patch: Partial<DraftProduct>) => onChange({ ...value, ...patch })

  return (
    <>
      <div className="df-field">
        <label htmlFor={`${id}-name`}>{words.fields.name}</label>
        <input id={`${id}-name`} type="text" maxLength={255} required value={value.name} onChange={(e) => set({ name: e.target.value })} />
      </div>
      <div className="df-field">
        <span id={`${id}-description`} className="df-sample-label">
          {words.fields.description}
        </span>
        {/* The sample's own limit (apps/api saas/storeCategories/editor.ts). */}
        <RichTextField value={value.description} readOnly={false} labelledBy={`${id}-description`} placeholder={words.descriptionPlaceholder} words={words.description} maxLength={5000} onChange={(description) => set({ description })} />
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
        <legend>{words.fields.photos}</legend>
        <SamplePhotosField photos={value.photos} name={value.name || words.fields.name} onChange={(photos) => set({ photos })} upload={upload} />
      </fieldset>
    </>
  )
}
