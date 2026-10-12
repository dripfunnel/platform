import { useId } from 'react'
import { messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'

const words = messages.storefront.brand

export interface ImageFieldProps {
  label: string
  help: string
  alt: string
  none: string
  assetId: string | null
  required?: boolean
  readOnly: boolean
  busy: boolean
  problem: string | null
  onFile: (file: File) => void
  /** Absent for an image the brand can't do without (the logo). */
  onRemove?: () => void
}

/** The logo or the favicon: what is there now, and Upload, Replace or Remove (FIRST-RELEASE §14 "Your brand"). */
export const ImageField = ({ label, help, alt, none, assetId, required = false, readOnly, busy, problem, onFile, onRemove }: ImageFieldProps) => {
  const id = useId()
  return (
    <div className="df-sf-image" role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-help`}>
      <span className="df-sf-label" id={`${id}-label`}>
        {label}
        {required && <span className="df-sf-required">{words.required}</span>}
      </span>
      <div className="df-sf-image-row">
        {assetId ? <AssetImage url={`/api/assets/${assetId}`} alt={alt} className="df-sf-image-preview" placeholder="" /> : <span className="df-sf-image-preview df-sf-image-preview--none">{none}</span>}
        {!readOnly && (
          <>
            <label className="df-button df-button--small df-sf-upload">
              {busy ? words.uploading : assetId ? words.replace : words.upload}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label={label}
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0]
                  e.target.value = ''
                  if (file) onFile(file)
                }}
              />
            </label>
            {assetId && onRemove && (
              <button type="button" className="df-sf-link" onClick={onRemove}>
                {words.removeImage}
              </button>
            )}
          </>
        )}
      </div>
      <span id={`${id}-help`} className={problem ? 'df-sf-problem' : 'df-sf-help'} role={problem ? 'alert' : undefined}>
        {problem ?? help}
      </span>
    </div>
  )
}
