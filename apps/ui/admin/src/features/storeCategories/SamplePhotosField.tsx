import { useId, useState } from 'react'
import { fill, messages } from '../../messages'
import { maxProductPhotos, type DraftPhoto } from './sampleDraft'
import { SampleThumb, type SamplePhotoUpload } from './SamplePhotoField'
import './storeCategories.css'

const words = messages.storeCategories.editor

export interface SamplePhotosFieldProps {
  photos: readonly DraftPhoto[]
  /** The product's name, for each photo's alt text and its buttons' names. */
  name: string
  onChange: (photos: DraftPhoto[]) => void
  upload: SamplePhotoUpload
}

/** A product's photos, the first its main one: chosen several at a time, each uploaded as it's chosen. */
export const SamplePhotosField = ({ photos, name, onChange, upload }: SamplePhotosFieldProps) => {
  const id = useId()
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const room = maxProductPhotos - photos.length

  // One at a time, so the photos keep the order they were picked in; the list changes once, when all are in.
  const choose = async (files: File[]) => {
    setUploading(true)
    setError(files.length > room ? fill(words.photoLimit, { count: String(maxProductPhotos) }) : null)
    const added: DraftPhoto[] = []
    for (const file of files.slice(0, room)) {
      const r = await upload(file)
      if (!r.ok) {
        setError(words.photoRefused[r.code])
        break
      }
      if (![...photos, ...added].some((p) => p.ref === r.ref)) added.push({ ref: r.ref, previewUrl: r.previewUrl })
    }
    setUploading(false)
    if (added.length > 0) onChange([...photos, ...added])
  }

  const labelOf = (n: number) => fill(words.photoNumber, { number: String(n + 1), name })

  return (
    <>
      {photos.length === 0 ? (
        <span className="df-field-hint">{words.noPhoto}</span>
      ) : (
        <ul className="df-sample-photo-list">
          {photos.map((photo, n) => (
            <li key={photo.ref} className="df-sample-photo-item">
              <SampleThumb photo={photo} alt={labelOf(n)} large />
              {n === 0 ? (
                <span className="df-field-hint">{words.mainPhoto}</span>
              ) : (
                <button type="button" className="df-button df-button--small" aria-label={`${words.makeMain}: ${labelOf(n)}`} disabled={uploading} onClick={() => onChange([photo, ...photos.filter((p) => p !== photo)])}>
                  {words.makeMain}
                </button>
              )}
              <button type="button" className="df-button df-button--small" aria-label={`${words.removePhoto}: ${labelOf(n)}`} disabled={uploading} onClick={() => onChange(photos.filter((p) => p !== photo))}>
                {words.removePhoto}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="df-sample-photo-field">
        <label className="df-button df-button--small df-sample-upload" htmlFor={`${id}-photos`} aria-disabled={uploading || room <= 0}>
          {uploading ? words.uploading : words.addPhotos}
          <input
            id={`${id}-photos`}
            type="file"
            multiple
            accept="image/png,image/jpeg,image/webp,image/gif"
            className="df-visually-hidden"
            disabled={uploading || room <= 0}
            onChange={(e) => {
              const files = [...(e.target.files ?? [])]
              e.target.value = ''
              if (files.length > 0) void choose(files)
            }}
          />
        </label>
        <span className="df-field-hint">{fill(words.photosHint, { count: String(maxProductPhotos) })}</span>
      </div>
      {error && (
        <p className="df-field-error" role="alert">
          {error}
        </p>
      )}
    </>
  )
}
