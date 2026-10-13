import { messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import type { StorefrontApi } from './storefrontApi'
import { usePhotoUpload } from './usePhotoUpload'

const words = messages.storefront.content.editor

/** A post's cover photo (StorefrontContent): the drawing's dashed box, uploading on pick. */
export const CoverField = ({ assetId, canEdit, api, onCover, onUploading }: { assetId: string | null; canEdit: boolean; api: StorefrontApi; onCover: (assetId: string | null) => void; onUploading: (busy: boolean) => void }) => {
  const { uploading: busy, problem, upload: send } = usePhotoUpload(api, onUploading)
  const upload = (file: File) => send(file, onCover)
  const label = busy ? words.uploading : assetId ? words.changeCover : words.addCover
  return (
    <div className="df-sfc-cover-field">
      <div className="df-sfc-cover">
        {assetId && <AssetImage url={`/api/assets/${assetId}`} alt="" className="df-sfc-photo-image" placeholder="" />}
        {canEdit ? (
          <label className="df-sfc-cover-pick">
            <span>{label}</span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              aria-label={label}
              disabled={busy}
              onChange={(e) => {
                const file = e.target.files?.[0]
                e.target.value = ''
                if (file) upload(file)
              }}
            />
          </label>
        ) : (
          !assetId && <span className="df-sfc-cover-pick">{words.noCover}</span>
        )}
      </div>
      {canEdit && assetId && (
        <button type="button" className="df-sf-link df-sf-link--danger" onClick={() => onCover(null)}>
          {words.removeCover}
        </button>
      )}
      {problem && (
        <span className="df-sf-problem" role="alert">
          {problem}
        </span>
      )}
    </div>
  )
}
