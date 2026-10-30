import { useEffect, useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { LibraryAsset } from '../../api/assetLibrary'
import type { DesignMessage, StockPhoto } from '../../api/studio'
import { fill, messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { askRefusal, noteText, sampleAddress } from './studioRules'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.studio.chat
const errorText = (code: string): string => {
  const reason = code.startsWith('change_failed:') ? code.slice('change_failed:'.length) : ''
  return Object.hasOwn(words.errorReasons, reason) ? words.errorReasons[reason as keyof typeof words.errorReasons] : words.error
}
const imageTypes = ['image/png', 'image/jpeg', 'image/webp']
const modelKey = 'df-studio-model'
const readModel = (): string | null => {
  try {
    return localStorage.getItem(modelKey)
  } catch {
    return null
  }
}
const writeModel = (model: string) => {
  try {
    localStorage.setItem(modelKey, model)
  } catch {
    // A private window keeps the choice for this visit only.
  }
}

export interface ChatRequest {
  text: string
  imageAssetId: string | null
  sampleUrl: string | null
  /** The model picked in the composer; null where there is no choice. */
  model: string | null
  mode: 'change' | 'chat'
}

export interface StudioChatProps {
  /** Oldest first. */
  chat: readonly DesignMessage[]
  /** Until the first read answers, and when it couldn't, the conversation says so instead of looking empty. */
  chatRead: 'loading' | 'ready' | 'failed'
  hasEarlier: boolean
  assistant: string
  templateName: (key: string) => string
  locked: boolean
  canEdit: boolean
  /** "Checking your change…" and the sandbox's states, shown as the AI's line. */
  busyLine: string | null
  error: string | null
  api: StorefrontApi
  onEarlier: () => void
  onUndo: (message: DesignMessage) => void
  /** Stops the change in progress; its own request then ends. */
  onStop: () => void
  /** Resolves true once the request was taken, so the words typed are kept when it was refused. */
  onSend: (request: ChatRequest) => Promise<boolean>
  /** A refused or rolled-back publish, after the conversation. */
  notice: ReactNode
  /** "AI requests: N left" or "On your own AI key". */
  aiLine: string | null
  /** What the store's AI account can run, the default first; empty hides the picker. */
  models: readonly string[]
}

interface Attached {
  assetId: string | null
  name: string
  /** The picked file shown from memory while it uploads. */
  preview?: string
}

/** "Design with AI" (PortalStorefront › studio): the conversation, suggestions and the composer with an image and a website. */
export const StudioChat = ({ chat, chatRead, hasEarlier, assistant, templateName, locked, canEdit, busyLine, error, api, onEarlier, onUndo, onStop, onSend, notice, aiLine, models }: StudioChatProps) => {
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<Attached | null>(null)
  const [site, setSite] = useState<string | null>(null)
  const [siteOpen, setSiteOpen] = useState(false)
  const [siteIn, setSiteIn] = useState('')
  const [siteErr, setSiteErr] = useState<string | null>(null)
  const [assetsOpen, setAssetsOpen] = useState(false)
  const [assetList, setAssetList] = useState<'loading' | 'failed' | LibraryAsset[]>('loading')
  const [stockOn, setStockOn] = useState(false)
  const [stockOpen, setStockOpen] = useState(false)
  const [stockIn, setStockIn] = useState('')
  const [stockState, setStockState] = useState<'idle' | 'loading' | 'failed' | StockPhoto[]>('idle')
  const [urlOpen, setUrlOpen] = useState(false)
  const [urlIn, setUrlIn] = useState('')
  const [urlErr, setUrlErr] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const [chatMode, setChatMode] = useState(false)
  const [last, setLast] = useState<ChatRequest | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const siteId = useId()
  const uploads = useRef(0)
  const undoable = [...chat].reverse().find((m) => m.role === 'ai' && m.canUndo)?.id ?? null

  useEffect(() => {
    const url = image?.preview
    return () => {
      if (url) URL.revokeObjectURL(url)
    }
  }, [image?.preview])
  const take = (file: File | null | undefined) => {
    setUploadErr(null)
    if (!file || !imageTypes.includes(file.type)) return setUploadErr(words.refused.INVALID_IMAGE)
    const mine = ++uploads.current
    const preview = URL.createObjectURL(file)
    setImage({ assetId: null, name: file.name || words.imageName, preview })
    api.uploadImage(file).then(
      (answer) => {
        if (mine !== uploads.current) return
        if (answer.ok) return setImage({ assetId: answer.assetId, name: file.name || words.imageName, preview })
        setImage(null)
        setUploadErr(words.refused.INVALID_IMAGE)
      },
      () => {
        if (mine !== uploads.current) return
        setImage(null)
        setUploadErr(words.refused.other)
      },
    )
  }
  useEffect(() => {
    void api.loadStockAvailable().then(setStockOn, () => setStockOn(false))
  }, [api])
  const openAssets = () => {
    setAssetsOpen(true)
    setStockOpen(false)
    setUrlOpen(false)
    setSiteOpen(false)
    setAssetList('loading')
    api.loadLibrary({ after: null, kind: 'image', search: '' }).then((page) => setAssetList(page.assets), () => setAssetList('failed'))
  }
  const pickAsset = (a: LibraryAsset) => {
    uploads.current += 1
    setAssetsOpen(false)
    setUploadErr(null)
    setImage({ assetId: a.id, name: a.name ?? words.imageName })
  }
  const searchStock = () => {
    if (stockIn.trim() === '') return
    setStockState('loading')
    api.searchStockImages(stockIn.trim(), 1).then(setStockState, (e: unknown) => (setStockState('failed'), setUploadErr(askRefusal(e))))
  }
  const pickStock = (photo: StockPhoto) => {
    const mine = ++uploads.current
    setStockOpen(false)
    setStockState('idle')
    setStockIn('')
    setUploadErr(null)
    setImage({ assetId: null, name: photo.user })
    api.useStockImage(photo.id).then(
      (assetId) => mine === uploads.current && setImage({ assetId, name: photo.user }),
      (e: unknown) => {
        if (mine !== uploads.current) return
        setImage(null)
        setUploadErr(askRefusal(e))
      },
    )
  }
  const addImageUrl = () => {
    const address = sampleAddress(urlIn)
    if (!address) return setUrlErr(words.imageUrlInvalid)
    const mine = ++uploads.current
    setUrlOpen(false)
    setUrlIn('')
    setUrlErr(null)
    setUploadErr(null)
    setImage({ assetId: null, name: new URL(address).hostname })
    api.importDesignImage(address).then(
      (assetId) => mine === uploads.current && setImage({ assetId, name: new URL(address).hostname }),
      (e: unknown) => {
        if (mine !== uploads.current) return
        setImage(null)
        setUploadErr(askRefusal(e))
      },
    )
  }
  const addSite = () => {
    const address = sampleAddress(siteIn)
    if (!address) return setSiteErr(words.siteInvalid)
    setSite(address)
    setSiteOpen(false)
    setSiteIn('')
    setSiteErr(null)
  }
  const [picked, setPicked] = useState(() => readModel())
  const model = picked && models.includes(picked) ? picked : (models[0] ?? null)
  const pick = (next: string) => (setPicked(next), writeModel(next))
  const ready = !locked && (image === null || image.assetId !== null) && (prompt.trim() !== '' || image !== null || site !== null)
  const send = (text: string, withAttached: boolean) => {
    if (locked) return
    const request: ChatRequest = { text: text || words.attachedOnly, imageAssetId: withAttached ? (image?.assetId ?? null) : null, sampleUrl: withAttached ? site : null, model, mode: chatMode ? 'chat' : 'change' }
    setLast(request)
    void onSend(request).then((taken) => {
      if (!taken || !withAttached) return
      setPrompt('')
      setImage(null)
      setSite(null)
    })
  }
  const retry = () => {
    if (!last || locked) return
    void onSend(last)
  }
  const onKey = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return
    event.preventDefault()
    if (ready) send(prompt.trim(), true)
  }
  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const item = Array.from(event.clipboardData.items).find((x) => x.kind === 'file' && x.type.startsWith('image/'))
    if (!item) return
    event.preventDefault()
    take(item.getAsFile())
  }

  return (
    <section className="df-studio-chat" aria-labelledby={`${siteId}-title`}>
      <header className="df-studio-chat-head">
        <h2 id={`${siteId}-title`}>{words.title}</h2>
        {aiLine && <span className="df-sf-lede">{aiLine}</span>}
      </header>
      <ol className="df-studio-messages" aria-live="polite">
        {hasEarlier && (
          <li>
            <button type="button" className="df-sf-link" onClick={onEarlier}>
              {words.earlier}
            </button>
          </li>
        )}
        {chatRead === 'loading' && (
          <li className="df-studio-ai">
            <span role="status">{words.loading}</span>
          </li>
        )}
        {chatRead === 'failed' && (
          <li>
            <p className="df-sf-failure" role="alert">
              {words.loadFailed}
            </p>
          </li>
        )}
        {chatRead === 'ready' && chat.length === 0 && <li className="df-studio-ai">{words.empty}</li>}
        {chat.map((m) => (
          <ChatLine key={m.id} message={m} assistant={assistant} templateName={templateName} canUndo={canEdit && !locked && m.id === undoable} onUndo={() => onUndo(m)} onRetry={canEdit && !locked && last && m.id === chat[chat.length - 1]?.id ? retry : null} />
        ))}
        {notice}
        {busyLine && (
          <li className="df-studio-ai">
            <span className="df-sf-eyebrow">{assistant}</span>
            <span className="df-studio-dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span role="status">{busyLine}</span>
          </li>
        )}
      </ol>
      {canEdit && (
        <div className="df-studio-compose">
          {!locked && (
            <ul className="df-studio-chips" aria-label={words.suggestionsLabel}>
              {words.suggestions.map((s) => (
                <li key={s}>
                  <button type="button" onClick={() => send(s, false)}>
                    {s}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="df-studio-box">
            {(image || site) && (
              <div className="df-studio-attached">
                {image && (
                  <span className="df-studio-chip df-studio-chip--image">
                    {image.preview ? <img className="df-studio-thumb" src={image.preview} alt="" /> : image.assetId ? <AssetImage url={`/api/assets/${image.assetId}`} alt="" className="df-studio-thumb" placeholder="" /> : <span className="df-studio-thumb df-studio-thumb--busy" />}
                    <span>{image.assetId ? image.name : words.uploading}</span>
                    <button type="button" aria-label={words.removeImage} onClick={() => ((uploads.current += 1), setImage(null))}>
                      <RemoveIcon />
                    </button>
                  </span>
                )}
                {site && (
                  <span className="df-studio-chip" title={site}>
                    <span>{new URL(site).hostname}</span>
                    <button type="button" aria-label={words.removeSite} onClick={() => setSite(null)}>
                      <RemoveIcon />
                    </button>
                  </span>
                )}
              </div>
            )}
            {siteOpen && <AddressRow id={siteId} label={words.siteLabel} value={siteIn} error={siteErr} onChange={(v) => (setSiteIn(v), setSiteErr(null))} onAdd={addSite} onCancel={() => (setSiteOpen(false), setSiteErr(null))} />}
            {assetsOpen && (
              <div className="df-studio-site df-studio-stock" role="dialog" aria-label={words.assetsLabel}>
                <label>{words.assetsLabel}</label>
                <button type="button" className="df-button df-button--small df-studio-upload" onClick={() => (setAssetsOpen(false), fileRef.current?.click())}>
                  {words.assetsUpload}
                </button>
                {assetList === 'loading' && <p role="status">{words.assetsLoading}</p>}
                {assetList === 'failed' && <p role="alert">{words.assetsFailed}</p>}
                {Array.isArray(assetList) && assetList.length === 0 && <p role="status">{words.assetsEmpty}</p>}
                {Array.isArray(assetList) && assetList.length > 0 && (
                  <ul className="df-studio-stock-grid">
                    {assetList.map((a) => (
                      <li key={a.id}>
                        <button type="button" aria-label={fill(words.assetsUse, { name: a.name ?? words.imageName })} title={a.name ?? undefined} onClick={() => pickAsset(a)}>
                          <AssetImage url={`/api/assets/${a.id}`} alt="" className="df-studio-image--thumb" placeholder="" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <button type="button" className="df-sf-link" onClick={() => setAssetsOpen(false)}>
                  {words.cancel}
                </button>
              </div>
            )}
            {stockOpen && (
              <div className="df-studio-site df-studio-stock" role="dialog" aria-label={words.stockLabel}>
                <label htmlFor={`${siteId}-stock`}>{words.stockLabel}</label>
                <div>
                  <input id={`${siteId}-stock`} type="search" placeholder={words.stockPlaceholder} aria-label={words.stockSearch} value={stockIn} onChange={(e) => setStockIn(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), searchStock())} />
                  <button type="button" className="df-button df-button--small" onClick={searchStock}>
                    {words.stockGo}
                  </button>
                  <button type="button" className="df-sf-link" onClick={() => (setStockOpen(false), setStockState('idle'))}>
                    {words.cancel}
                  </button>
                </div>
                {stockState === 'loading' && <p role="status">{words.stockLoading}</p>}
                {Array.isArray(stockState) && stockState.length === 0 && <p role="status">{words.stockNone}</p>}
                {Array.isArray(stockState) && stockState.length > 0 && (
                  <ul className="df-studio-stock-grid">
                    {stockState.map((p) => (
                      <li key={p.id}>
                        <button type="button" aria-label={fill(words.stockUse, { user: p.user })} title={p.tags} onClick={() => pickStock(p)}>
                          <img src={p.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <p className="df-sf-lede">{words.stockCredit}</p>
              </div>
            )}
            {urlOpen && <AddressRow id={`${siteId}-image`} label={words.imageUrlLabel} value={urlIn} error={urlErr} onChange={(v) => (setUrlIn(v), setUrlErr(null))} onAdd={addImageUrl} onCancel={() => (setUrlOpen(false), setUrlErr(null))} />}
            <textarea aria-label={words.prompt} rows={3} placeholder={chatMode ? words.placeholderChat : words.placeholder} value={prompt} readOnly={locked} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
            <div className="df-studio-actions">
              <div className="df-studio-tools">
              <input ref={fileRef} type="file" accept={imageTypes.join(',')} hidden tabIndex={-1} onChange={(e) => (take(e.target.files?.[0]), (e.target.value = ''))} />
              <button type="button" className="df-studio-icon" aria-label={words.assets} title={words.assetsTitle} disabled={locked} onClick={openAssets}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17 M15.5 9.5h.01" />
                </svg>
              </button>
              {stockOn && (
                <button type="button" className="df-studio-icon" aria-label={words.stock} title={words.stock} disabled={locked} onClick={() => (setStockOpen(true), setAssetsOpen(false), setUrlOpen(false), setSiteOpen(false), setStockIn(''), setStockState('idle'))}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="6" />
                    <path d="M20 20l-4.2-4.2" />
                  </svg>
                </button>
              )}
              <button type="button" className="df-studio-icon" aria-label={words.addImageUrl} title={words.addImageUrl} disabled={locked} onClick={() => (setUrlOpen(true), setSiteOpen(false), setUrlIn(''), setUrlErr(null))}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="12" cy="12" r="8" />
                  <path d="M4 12h16 M12 4c2.5 2.2 2.5 13.8 0 16 M12 4c-2.5 2.2-2.5 13.8 0 16" />
                </svg>
              </button>
              <button type="button" className="df-studio-icon" aria-label={words.addSite} title={words.addSiteTitle} disabled={locked} onClick={() => (setSiteOpen(true), setUrlOpen(false), setSiteIn(''), setSiteErr(null))}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                </svg>
              </button>
              <div role="group" aria-label={words.mode} className="df-studio-modes">
                <button type="button" aria-pressed={!chatMode} disabled={locked} onClick={() => setChatMode(false)}>
                  {words.modeChange}
                </button>
                <button type="button" aria-pressed={chatMode} disabled={locked} onClick={() => setChatMode(true)}>
                  {words.modeChat}
                </button>
              </div>
              </div>
              <div className="df-studio-send-group">
              {models.length > 1 && (
                <select className="df-studio-model" aria-label={words.model} value={model ?? ''} disabled={locked} onChange={(e) => pick(e.target.value)}>
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              )}
              {locked ? (
                <button type="button" className="df-button df-studio-send df-studio-stop" aria-label={words.stop} title={words.stop} onClick={onStop}>
                  <svg width="12" height="12" viewBox="0 0 10 10" aria-hidden="true">
                    <rect width="10" height="10" rx="2" fill="currentColor" />
                  </svg>
                </button>
              ) : (
                <button type="button" className="df-button df-button--primary df-studio-send" aria-label={words.send} title={words.hint} disabled={!ready} onClick={() => send(prompt.trim(), true)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M12 19V5 M5 12l7-7 7 7" />
                  </svg>
                </button>
              )}
              </div>
            </div>
          </div>
          {(uploadErr ?? error) && (
            <p className="df-sf-problem" role="alert">
              {uploadErr ?? error}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

const AddressRow = ({ id, label, value, error, onChange, onAdd, onCancel }: { id: string; label: string; value: string; error: string | null; onChange: (value: string) => void; onAdd: () => void; onCancel: () => void }) => (
  <div className="df-studio-site">
    <label htmlFor={id}>{label}</label>
    <div>
      <input id={id} type="url" placeholder={words.sitePlaceholder} aria-invalid={error !== null} value={value} onChange={(e) => onChange(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), onAdd())} />
      <button type="button" className="df-button df-button--small" onClick={onAdd}>
        {words.add}
      </button>
      <button type="button" className="df-sf-link" onClick={onCancel}>
        {words.cancel}
      </button>
    </div>
    {error && (
      <p className="df-sf-problem" role="alert">
        {error}
      </p>
    )}
  </div>
)

const RemoveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

const ChatLine = ({ message: m, assistant, templateName, canUndo, onUndo, onRetry }: { message: DesignMessage; assistant: string; templateName: (key: string) => string; canUndo: boolean; onUndo: () => void; onRetry: (() => void) | null }) => {
  if (m.role === 'user')
    return (
      <li className="df-studio-user">
        {m.imageAssetId && <AssetImage url={`/api/assets/${m.imageAssetId}`} alt={words.imageAlt} className="df-studio-image" placeholder={words.imageAlt} />}
        {m.sampleUrl && sampleAddress(m.sampleUrl) && (
          <span className="df-studio-chip" title={m.sampleUrl}>
            {new URL(m.sampleUrl).hostname}
          </span>
        )}
        {m.text && <p>{m.text}</p>}
      </li>
    )
  if (m.role === 'note') {
    const text = noteText(m.text, templateName)
    if (!text) return null
    return (
      <li className="df-studio-note">
        {m.imageAssetId && <AssetImage url={`/api/assets/${m.imageAssetId}`} alt="" className="df-studio-thumb" placeholder="" />}
        {text}
      </li>
    )
  }
  if (m.role === 'error')
    return (
      <li className="df-sf-failure">
        {errorText(m.text)}
        {onRetry && (
          <button type="button" className="df-sf-link df-sf-link--underline" onClick={onRetry}>
            {words.retry}
          </button>
        )}
      </li>
    )
  return (
    <li className="df-studio-ai">
      <span className="df-sf-eyebrow">{assistant}</span>
      <span>{m.text}</span>
      {m.changed.length > 0 && !m.undone && (
        <ul className="df-studio-changed">
          {m.changed.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
      {canUndo && (
        <button type="button" className="df-sf-link df-sf-link--underline" onClick={onUndo}>
          {words.undo}
        </button>
      )}
      {m.undone && <span className="df-sf-lede">{words.undone}</span>}
    </li>
  )
}
