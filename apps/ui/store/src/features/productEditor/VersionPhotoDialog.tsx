import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useRef, useState } from 'react'
import { fill, formatCount, messages, plural } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import type { DraftPhoto } from '../common/productDraft'

const words = messages.editor

export type VersionPhotoUpload = (file: File) => Promise<{ ok: true; assetId: string } | { ok: false; message: string }>

/** "Photo for {version}": one of the product's photos, or a new one added to Photos too (#1460). */
export const VersionPhotoDialog = ({ name, photos, usedBy, current, upload, onUse, onMain, onCancel }: { name: string; photos: readonly DraftPhoto[]; usedBy: (assetId: string) => number; current: string | null; upload: VersionPhotoUpload; onUse: (assetId: string) => void; onMain: () => void; onCancel: () => void }) => {
  const [picked, setPicked] = useState(current)
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const send = async (file: File) => {
    setBusy(true)
    setProblem(null)
    const result = await upload(file)
    setBusy(false)
    if (result.ok) setPicked(result.assetId)
    else setProblem(result.message)
  }
  return (
    <ConfirmDialog
      open
      title={fill(words.versions.photoTitle, { name })}
      target={fill(words.versions.photoProducts, { count: formatCount(photos.length) })}
      consequence={words.versions.photoFrom}
      confirmLabel={words.versions.photoUse}
      cancelLabel={messages.editor.cancel}
      blocked={busy ? words.photos.uploading : picked === null ? words.versions.photoPick : null}
      error={problem}
      onCancel={onCancel}
      onConfirm={() => picked && onUse(picked)}
    >
      <p className="df-field-hint">{words.versions.photoLine}</p>
      <ul className="df-editor-vpick" role="radiogroup" aria-label={fill(words.versions.photoTitle, { name })}>
        {photos.map((p, i) => {
          const count = usedBy(p.assetId)
          const label = p.alt || fill(words.versions.photoName, { number: formatCount(i + 1) })
          return (
            <li key={p.assetId}>
              <button type="button" role="radio" aria-checked={picked === p.assetId} className="df-editor-vpick-tile" onClick={() => setPicked(p.assetId)}>
                <AssetImage className="df-editor-photo-img" url={p.url} alt="" placeholder="" />
                <strong>{label}</strong>
                <span>{count > 0 ? fill(plural(words.versions.photoUsed, count), { count: formatCount(count) }) : words.versions.photoUnused}</span>
              </button>
            </li>
          )
        })}
        <li>
          <button type="button" className="df-editor-vpick-tile df-editor-vpick-tile--add" disabled={busy} onClick={() => input.current?.click()}>
            <span aria-hidden="true">+</span>
            <strong>{words.versions.photoUploadNew}</strong>
            <span>{words.versions.photoUploadHint}</span>
          </button>
          <input
            ref={input}
            className="df-visually-hidden"
            type="file"
            accept="image/jpeg,image/png,image/webp,image/avif,image/heic"
            tabIndex={-1}
            aria-hidden="true"
            onChange={(event) => {
              const file = event.target.files?.[0]
              if (file) void send(file)
              event.target.value = ''
            }}
          />
        </li>
      </ul>
      {current !== null && (
        <button type="button" className="df-editor-link" disabled={busy} onClick={onMain}>
          {words.versions.photoMain}
        </button>
      )}
    </ConfirmDialog>
  )
}
