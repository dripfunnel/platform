import { isApiError } from '@dripfunnel/shared/graphql'
import { ConfirmDialog } from '@dripfunnel/shared/ui'
import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { LibraryAsset } from '../../api/assetLibrary'
import { messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.assets
const accepted = ['image/png', 'image/jpeg', 'image/webp', 'video/mp4']

const size = (bytes: number): string => (bytes >= 1_000_000 ? `${(bytes / 1_000_000).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1000))} KB`)

interface AssetsTabProps {
  api: Pick<StorefrontApi, 'loadLibrary' | 'uploadAsset' | 'renameLibraryAsset' | 'deleteLibraryAsset'>
  canEdit: boolean
  onToast: (text: string) => void
}

/** Storefront › Assets (PortalStorefront): the store's own images and videos; the studio picks from them. */
export const AssetsTab = ({ api, canEdit, onToast }: AssetsTabProps) => {
  const [assets, setAssets] = useState<LibraryAsset[]>([])
  const [next, setNext] = useState<string | null>(null)
  const [read, setRead] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [search, setSearch] = useState('')
  const [asked, setAsked] = useState('')
  const [uploading, setUploading] = useState(0)
  const [problem, setProblem] = useState<string | null>(null)
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [deleting, setDeleting] = useState<LibraryAsset | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const reads = useRef(0)
  const searchId = useId()

  const load = useCallback(
    (after: string | null, words_: string) => {
      const mine = ++reads.current
      if (after === null) setRead('loading')
      api.loadLibrary({ after, kind: null, search: words_ }).then(
        (page) => {
          if (mine !== reads.current) return
          setAssets((was) => (after === null ? page.assets : [...was, ...page.assets]))
          setNext(page.next)
          setRead('ready')
        },
        () => mine === reads.current && setRead('failed'),
      )
    },
    [api],
  )
  useEffect(() => load(null, asked), [load, asked])
  useEffect(() => {
    const id = setTimeout(() => setAsked(search.trim()), 300)
    return () => clearTimeout(id)
  }, [search])

  const upload = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setProblem(null)
    for (const file of Array.from(files)) {
      if (!accepted.includes(file.type)) {
        setProblem(words.uploadRefused.UNSUPPORTED_TYPE)
        continue
      }
      setUploading((n) => n + 1)
      const done = await api.uploadAsset(file).catch(() => ({ ok: false as const, code: 'NOT_CONNECTED' as const }))
      setUploading((n) => n - 1)
      if (!done.ok) setProblem(words.uploadRefused[done.code])
    }
    load(null, asked)
  }
  const saveName = () => {
    if (!renaming) return
    const { id, name } = renaming
    setRenaming(null)
    api.renameLibraryAsset(id, name).then(
      () => setAssets((was) => was.map((a) => (a.id === id ? { ...a, name: name.trim() || null } : a))),
      () => setProblem(words.gone),
    )
  }
  const remove = (asset: LibraryAsset) => {
    setDeleting(null)
    api.deleteLibraryAsset(asset.id).then(
      () => (setAssets((was) => was.filter((a) => a.id !== asset.id)), onToast(words.deleted)),
      (e: unknown) => {
        setProblem(isApiError(e, 'ASSET_IN_USE') ? words.inUse : words.gone)
        load(null, asked)
      },
    )
  }

  return (
    <section className="df-assets" aria-labelledby={`${searchId}-title`}>
      <header className="df-assets-head">
        <div>
          <h2 id={`${searchId}-title`}>{words.title}</h2>
          <p className="df-sf-lede">{words.sub}</p>
        </div>
        <input id={searchId} type="search" aria-label={words.search} placeholder={words.searchPlaceholder} value={search} onChange={(e) => setSearch(e.target.value)} />
        {canEdit && (
          <>
            <input ref={fileRef} type="file" accept={accepted.join(',')} multiple hidden tabIndex={-1} onChange={(e) => (void upload(e.target.files), (e.target.value = ''))} />
            <button type="button" className="df-button df-button--primary" disabled={uploading > 0} onClick={() => fileRef.current?.click()}>
              {uploading > 0 ? words.uploading : words.upload}
            </button>
          </>
        )}
      </header>
      {problem && (
        <p className="df-sf-problem" role="alert">
          {problem}
        </p>
      )}
      {read === 'loading' && <p role="status">{words.loading}</p>}
      {read === 'failed' && (
        <p className="df-sf-failure" role="alert">
          {words.failed}{' '}
          <button type="button" className="df-sf-link df-sf-link--underline" onClick={() => load(null, asked)}>
            {words.retry}
          </button>
        </p>
      )}
      {read === 'ready' && assets.length === 0 && <p className="df-sf-lede">{asked ? words.emptySearch : words.empty}</p>}
      {assets.length > 0 && (
        <ul className="df-assets-grid">
          {assets.map((a) => (
            <li key={a.id} className="df-assets-card">
              {a.kind === 'image' ? <AssetImage url={`/api/assets/${a.id}`} alt={a.name ?? words.unnamed} className="df-assets-thumb" placeholder={words.image} /> : <span className="df-assets-thumb df-assets-thumb--none">{words.video}</span>}
              <div className="df-assets-meta">
                {renaming?.id === a.id ? (
                  <form
                    onSubmit={(e) => (e.preventDefault(), saveName())}
                  >
                    <input aria-label={words.renameLabel} maxLength={120} value={renaming.name} onChange={(e) => setRenaming({ id: a.id, name: e.target.value })} />
                    <button type="submit" className="df-button df-button--small">
                      {words.save}
                    </button>
                    <button type="button" className="df-sf-link" onClick={() => setRenaming(null)}>
                      {words.cancel}
                    </button>
                  </form>
                ) : (
                  <strong title={a.name ?? undefined}>{a.name ?? words.unnamed}</strong>
                )}
                <span>
                  {a.kind === 'image' ? words.image : words.video} · {size(a.bytes)}
                </span>
                <span>{a.uses > 0 ? words.used : words.unused}</span>
              </div>
              {canEdit && renaming?.id !== a.id && (
                <div className="df-assets-actions">
                  <button type="button" className="df-sf-link df-sf-link--underline" onClick={() => setRenaming({ id: a.id, name: a.name ?? '' })}>
                    {words.rename}
                  </button>
                  {a.uses === 0 && (
                    <button type="button" className="df-sf-link df-sf-link--underline df-assets-delete" onClick={() => setDeleting(a)}>
                      {words.delete}
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {next && (
        <button type="button" className="df-sf-link df-sf-link--underline" onClick={() => load(next, asked)}>
          {words.more}
        </button>
      )}
      {assets.length > 0 && <p className="df-sf-lede">{words.note}</p>}
      {deleting && <ConfirmDialog open title={words.deleteTitle} target={deleting.name ?? words.unnamed} consequence={words.deleteConsequence} confirmLabel={words.deleteConfirm} cancelLabel={words.cancel} onCancel={() => setDeleting(null)} onConfirm={() => remove(deleting)} />}
    </section>
  )
}
