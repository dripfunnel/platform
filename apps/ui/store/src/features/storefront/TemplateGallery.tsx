import { EmptyState } from '@dripfunnel/shared/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { scratchTemplate, type StorefrontStatus, type StorefrontTemplate } from '../../api/storefront'
import { fill, messages } from '../../messages'
import { isHttps } from '../common/https'
import { chooseRefusal, hasSite } from './overviewView'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.gallery

export interface TemplateGalleryProps {
  templates: readonly StorefrontTemplate[]
  status: StorefrontStatus
  api: StorefrontApi
  /** Null on the first visit, when there is nothing to go back to. */
  onBack: (() => void) | null
  onChosen: (template: StorefrontTemplate, status: StorefrontStatus) => void
}

/** The template gallery (PortalStorefront › gallery; FIRST-RELEASE §14): six looks and "Start from scratch". */
export const TemplateGallery = ({ templates, status, api, onBack, onChosen }: TemplateGalleryProps) => {
  const [asking, setAsking] = useState<StorefrontTemplate | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(status === 'create_failed' ? words.failed : null)
  const working = useRef(false)

  const choose = (template: StorefrontTemplate, keepWords: boolean) => {
    if (working.current) return
    working.current = true
    setAsking(null)
    setBusy(template.key)
    setError(null)
    api.chooseTemplate(template.key, keepWords).then(
      (next) => onChosen(template, next),
      (e: unknown) => {
        working.current = false
        setBusy(null)
        setError(chooseRefusal(e))
      },
    )
  }
  // A store with a site already keeps or replaces its words; the first pick has none to keep.
  const pick = (template: StorefrontTemplate) => (hasSite(status) ? setAsking(template) : choose(template, true))

  return (
    <div className="df-sf df-sf-gallery">
      {onBack && (
        <button type="button" className="df-sf-link df-sf-back" onClick={onBack}>
          {words.back}
        </button>
      )}
      <header className="df-sf-head">
        <h1 className="df-sf-title">{hasSite(status) ? words.change : words.first}</h1>
        <p className="df-sf-sub">{words.lede}</p>
      </header>
      {error && (
        <p className="df-sf-failure" role="alert">
          {error}
        </p>
      )}
      {templates.length === 0 ? (
        <EmptyState title={words.emptyTitle} body={words.emptyBody} />
      ) : (
        <ul className="df-sf-templates">
          {templates.map((t) => (
            <TemplateCard key={t.key} template={t} busy={busy} onPick={() => pick(t)} />
          ))}
        </ul>
      )}
      <KeepWordsDialog template={asking} onCancel={() => setAsking(null)} onChoose={choose} />
    </div>
  )
}

const templatePicture = (key: string): string => `${import.meta.env.BASE_URL}templates/${encodeURIComponent(key)}.webp`

const TemplateCard = ({ template, busy, onPick }: { template: StorefrontTemplate; busy: string | null; onPick: () => void }) => {
  const nameId = useId()
  const [pictured, setPictured] = useState(true)
  const scratch = template.key === scratchTemplate
  return (
    <li className={`df-sf-template${scratch ? ' df-sf-template--scratch' : ''}${template.current ? ' df-sf-template--current' : ''}`}>
      {/* One picture per template, the same for every store; a key without one keeps the name tile (FIRST-RELEASE §14). */}
      <div className="df-sf-template-thumb">
        {pictured ? <img src={templatePicture(template.key)} alt="" loading="lazy" onError={() => setPictured(false)} /> : <span aria-hidden="true">{template.name}</span>}
      </div>
      {template.current && <span className="df-sf-badge">{words.current}</span>}
      <div className="df-sf-template-body">
        <div className="df-sf-template-name">
          <h2 id={nameId}>{template.name}</h2>
          <span>{template.tag}</span>
        </div>
        <p>{template.description}</p>
        <div className="df-sf-template-actions">
          {template.demoUrl && isHttps(template.demoUrl) && (
            <a className="df-sf-link" href={template.demoUrl} target="_blank" rel="noopener noreferrer" aria-describedby={nameId}>
              {words.demo}
            </a>
          )}
          <button type="button" className="df-button df-sf-use" disabled={busy !== null} aria-describedby={nameId} onClick={onPick}>
            {busy === template.key ? words.choosing : scratch ? words.scratch : words.use}
          </button>
        </div>
      </div>
    </li>
  )
}

const KeepWordsDialog = ({ template, onCancel, onChoose }: { template: StorefrontTemplate | null; onCancel: () => void; onChoose: (t: StorefrontTemplate, keepWords: boolean) => void }) => {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const bodyId = useId()
  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (template && !dialog.open) dialog.showModal()
    else if (!template && dialog.open) dialog.close()
  }, [template])
  return (
    <dialog
      ref={ref}
      className="df-dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      onCancel={(event) => {
        event.preventDefault()
        onCancel()
      }}
    >
      {template && (
        <>
          <h2 id={titleId}>{template.key === scratchTemplate ? words.keepScratchTitle : fill(words.keepTitle, { name: template.name })}</h2>
          <div id={bodyId} className="df-dialog-body">
            <p>{words.keepBody}</p>
          </div>
          <div className="df-actions">
            <button type="button" className="df-button" onClick={onCancel}>
              {words.cancel}
            </button>
            <button type="button" className="df-button" onClick={() => onChoose(template, false)}>
              {words.templateWords}
            </button>
            <button type="button" className="df-button df-button--primary" onClick={() => onChoose(template, true)}>
              {words.keepWords}
            </button>
          </div>
        </>
      )}
    </dialog>
  )
}
