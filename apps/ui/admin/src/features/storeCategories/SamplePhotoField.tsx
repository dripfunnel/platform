import { useId, useState } from 'react'
import type { PhotoRefusal } from '../../api/storeCategorySample'
import { fill, messages } from '../../messages'
import type { DraftPhoto } from './sampleDraft'
import './storeCategories.css'

const words = messages.storeCategories.editor

export type SamplePhotoUpload = (file: File) => Promise<{ ok: true; ref: string; previewUrl: string } | { ok: false; code: PhotoRefusal }>

/** A sample photo's preview, or "No photo". */
export const SampleThumb = ({ photo, alt, large = false }: { photo: DraftPhoto | null | undefined; alt: string; large?: boolean }) =>
  photo?.previewUrl ? (
    <img src={photo.previewUrl} alt={alt} className={large ? 'df-sample-thumb df-sample-thumb--large' : 'df-sample-thumb'} />
  ) : (
    <span className="df-field-hint">{words.noPhoto}</span>
  )

export interface SamplePhotoFieldProps {
  photo: DraftPhoto | null
  /** Whose photo it is: a product's or a collection's name, for the alt text and the buttons' names. */
  name: string
  large?: boolean
  onChange: (photo: DraftPhoto | null) => void
  upload: SamplePhotoUpload
}

/** A sample photo: it goes up as soon as it's chosen, and the sample names it on Save. */
export const SamplePhotoField = ({ photo, name, large = false, onChange, upload }: SamplePhotoFieldProps) => {
  const id = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const choose = (file: File) => {
    setUploading(true)
    setError(null)
    void upload(file).then((r) => {
      setUploading(false)
      if (r.ok) onChange({ ref: r.ref, previewUrl: r.previewUrl })
      else setError(words.photoRefused[r.code])
    })
  }

  return (
    <>
      <div className="df-sample-photo-field">
        <SampleThumb photo={photo} alt={fill(words.photoAlt, { name })} large={large} />
        <label className="df-button df-button--small df-sample-upload" htmlFor={`${id}-photo`}>
          {uploading ? words.uploading : photo ? words.replacePhoto : words.uploadPhoto}
          <input
            id={`${id}-photo`}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="df-visually-hidden"
            aria-label={`${photo ? words.replacePhoto : words.uploadPhoto}: ${name}`}
            disabled={uploading}
            onChange={(e) => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) choose(file)
            }}
          />
        </label>
        {photo && (
          <button type="button" className="df-button df-button--small" aria-label={`${words.removePhoto}: ${name}`} onClick={() => onChange(null)}>
            {words.removePhoto}
          </button>
        )}
      </div>
      {error && (
        <p className="df-field-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
