import { useId, useRef } from 'react'
import { AssetImage } from './AssetImage'
import './imageField.css'

export interface ImageFieldWords {
  upload: string
  replace: string
  uploading: string
  remove: string
  /** Beside the label of an image that can't be left out. */
  required?: string
}

export interface ImageFieldProps {
  label: string
  help: string
  alt: string
  none: string
  assetId: string | null
  words: ImageFieldWords
  /** The types the upload takes, as the file picker's filter. */
  accept?: string
  required?: boolean
  readOnly: boolean
  busy: boolean
  problem: string | null
  onFile: (file: File) => void
  /** Absent for an image that can't be left out (the brand's logo). */
  onRemove?: () => void
}

/** One store image: what is there now, and Upload, Replace or Remove (the brand's logo and favicon, a collection's image). */
export const ImageField = ({ label, help, alt, none, assetId, words, accept = 'image/png,image/jpeg,image/webp', required = false, readOnly, busy, problem, onFile, onRemove }: ImageFieldProps) => {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  return (
    <div className="df-image-field" role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`}>
      <span className="df-image-field-label" id={`${id}-label`}>
        {label}
        {required && words.required && <span className="df-image-field-required">{words.required}</span>}
      </span>
      <div className="df-image-field-row">
        {assetId ? <AssetImage url={`/api/assets/${assetId}`} alt={alt} className="df-image-field-preview" placeholder="" /> : <span className="df-image-field-preview df-image-field-preview--none">{none}</span>}
        {!readOnly && (
          <>
            <label className="df-button df-button--small df-image-field-upload">
              {busy ? words.uploading : assetId ? words.replace : words.upload}
              {/* aria-disabled, not disabled, so the focus stays on it while the file uploads (WCAG 2.4.3). */}
              <input
                ref={input}
                type="file"
                accept={accept}
                aria-label={label}
                aria-disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file && !busy) onFile(file)
                }}
              />
            </label>
            {assetId && onRemove && !busy && (
              <button
                type="button"
                className="df-image-field-remove"
                onClick={() => {
                  onRemove()
                  input.current?.focus()
                }}
              >
                {words.remove}
              </button>
            )}
          </>
        )}
      </div>
      <span id={`${id}-help`} className={problem ? 'df-image-field-problem' : 'df-image-field-help'} role={problem ? 'alert' : undefined}>
        {problem ?? help}
      </span>
    </div>
  )
}
