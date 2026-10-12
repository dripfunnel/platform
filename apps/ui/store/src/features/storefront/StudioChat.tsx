import { useId, useRef, useState, type ClipboardEvent, type KeyboardEvent, type ReactNode } from 'react'
import type { DesignMessage } from '../../api/studio'
import { messages } from '../../messages'
import { AssetImage } from '../common/AssetImage'
import { noteText, sampleAddress } from './studioRules'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.studio.chat
const imageTypes = ['image/png', 'image/jpeg', 'image/webp']

export interface ChatRequest {
  text: string
  imageAssetId: string | null
  sampleUrl: string | null
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
  /** Resolves true once the request was taken, so the words typed are kept when it was refused. */
  onSend: (request: ChatRequest) => Promise<boolean>
  /** A refused or rolled-back publish, after the conversation. */
  notice: ReactNode
}

interface Attached {
  assetId: string | null
  name: string
}

/** "Design with AI" (PortalStorefront › studio): the conversation, suggestions and the composer with an image and a website. */
export const StudioChat = ({ chat, chatRead, hasEarlier, assistant, templateName, locked, canEdit, busyLine, error, api, onEarlier, onUndo, onSend, notice }: StudioChatProps) => {
  const [prompt, setPrompt] = useState('')
  const [image, setImage] = useState<Attached | null>(null)
  const [site, setSite] = useState<string | null>(null)
  const [siteOpen, setSiteOpen] = useState(false)
  const [siteIn, setSiteIn] = useState('')
  const [siteErr, setSiteErr] = useState<string | null>(null)
  const [uploadErr, setUploadErr] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const siteId = useId()
  const uploads = useRef(0)
  const undoable = [...chat].reverse().find((m) => m.role === 'ai' && m.canUndo)?.id ?? null

  const take = (file: File | null | undefined) => {
    setUploadErr(null)
    if (!file || !imageTypes.includes(file.type)) return setUploadErr(words.refused.INVALID_IMAGE)
    const mine = ++uploads.current
    setImage({ assetId: null, name: file.name || words.imageName })
    api.uploadImage(file).then(
      (answer) => {
        if (mine !== uploads.current) return
        if (answer.ok) return setImage({ assetId: answer.assetId, name: file.name || words.imageName })
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
  const addSite = () => {
    const address = sampleAddress(siteIn)
    if (!address) return setSiteErr(words.siteInvalid)
    setSite(address)
    setSiteOpen(false)
    setSiteIn('')
    setSiteErr(null)
  }
  const ready = !locked && (image === null || image.assetId !== null) && (prompt.trim() !== '' || image !== null || site !== null)
  const send = (text: string, withAttached: boolean) => {
    if (locked) return
    const request = { text: text || words.attachedOnly, imageAssetId: withAttached ? (image?.assetId ?? null) : null, sampleUrl: withAttached ? site : null }
    void onSend(request).then((taken) => {
      if (!taken || !withAttached) return
      setPrompt('')
      setImage(null)
      setSite(null)
    })
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
          <ChatLine key={m.id} message={m} assistant={assistant} templateName={templateName} canUndo={canEdit && !locked && m.id === undoable} onUndo={() => onUndo(m)} />
        ))}
        {notice}
        {busyLine && (
          <li className="df-studio-ai">
            <span className="df-sf-eyebrow">{assistant}</span>
            <span role="status">{busyLine}</span>
          </li>
        )}
      </ol>
      {canEdit && (
        <div className="df-studio-compose">
          {!locked && (
            <ul className="df-studio-suggestions" aria-label={words.suggestionsLabel}>
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
                  <span className="df-studio-chip">
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
            {siteOpen && (
              <div className="df-studio-site">
                <label htmlFor={siteId}>{words.siteLabel}</label>
                <div>
                  <input
                    id={siteId}
                    type="url"
                    placeholder={words.sitePlaceholder}
                    aria-invalid={siteErr !== null}
                    value={siteIn}
                    onChange={(e) => (setSiteIn(e.target.value), setSiteErr(null))}
                    onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), addSite())}
                  />
                  <button type="button" className="df-button df-button--small" onClick={addSite}>
                    {words.add}
                  </button>
                  <button type="button" className="df-sf-link" onClick={() => (setSiteOpen(false), setSiteErr(null))}>
                    {words.cancel}
                  </button>
                </div>
                {siteErr && (
                  <p className="df-sf-problem" role="alert">
                    {siteErr}
                  </p>
                )}
              </div>
            )}
            <textarea aria-label={words.prompt} rows={3} placeholder={words.placeholder} value={prompt} readOnly={locked} onChange={(e) => setPrompt(e.target.value)} onKeyDown={onKey} onPaste={onPaste} />
            <div className="df-studio-actions">
              <input ref={fileRef} type="file" accept={imageTypes.join(',')} hidden tabIndex={-1} onChange={(e) => (take(e.target.files?.[0]), (e.target.value = ''))} />
              <button type="button" className="df-studio-icon" aria-label={words.addImage} title={words.addImageTitle} disabled={locked} onClick={() => fileRef.current?.click()}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M4 5h16v14H4z M4 16l4.5-4.5 3.5 3.5 2.5-2.5L20 17 M15.5 9.5h.01" />
                </svg>
              </button>
              <button type="button" className="df-studio-icon" aria-label={words.addSite} title={words.addSiteTitle} disabled={locked} onClick={() => (setSiteOpen(true), setSiteIn(''), setSiteErr(null))}>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1 M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
                </svg>
              </button>
              <span className="df-studio-hint">{words.hint}</span>
              <button type="button" className="df-button df-button--primary df-studio-send" disabled={!ready} onClick={() => send(prompt.trim(), true)}>
                {locked && busyLine ? words.sending : words.send}
              </button>
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

const RemoveIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

const ChatLine = ({ message: m, assistant, templateName, canUndo, onUndo }: { message: DesignMessage; assistant: string; templateName: (key: string) => string; canUndo: boolean; onUndo: () => void }) => {
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
    return text ? <li className="df-studio-note">{text}</li> : null
  }
  if (m.role === 'error')
    return (
      <li className="df-sf-failure">
        {words.error}
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
