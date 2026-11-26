import { EmptyState } from '@dripfunnel/shared/ui'
import { useEffect, useId, useRef, useState } from 'react'
import { scratchTemplate, type StorefrontStatus, type StorefrontTemplate } from '../../api/storefront'
import { fill, messages } from '../../messages'
import { chooseRefusal, hasSite } from './overviewView'
import type { StorefrontApi } from './storefrontApi'
import { demoUrlOf, TemplateList } from './TemplateList'
import { wakeStudio } from './useStudioActivity'

const words = messages.storefront.gallery

export interface TemplateGalleryProps {
  templates: readonly StorefrontTemplate[]
  status: StorefrontStatus
  api: StorefrontApi
  /** Null on the first visit, when there is nothing to go back to. */
  onBack: (() => void) | null
  onChosen: (template: StorefrontTemplate, status: StorefrontStatus) => void
}

/** The template gallery (PortalStorefront › gallery; FIRST-RELEASE §14): Classic and "Start from scratch". */
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
  // A store with a site already keeps or replaces its words; the first pick has none to keep. Picking wakes its studio (AI-STUDIO §7).
  const pick = (template: StorefrontTemplate) => {
    if (!hasSite(status)) return choose(template, true)
    wakeStudio(api)
    setAsking(template)
  }

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
        <TemplateList
          templates={templates}
          isCurrent={(t) => t.current}
          actions={(t, nameId) => {
            const demo = demoUrlOf(t)
            return (
              <>
                {demo && (
                  <a className="df-sf-link" href={demo} target="_blank" rel="noopener noreferrer" aria-describedby={nameId}>
                    {words.demo}
                  </a>
                )}
                <button type="button" className="df-button df-sf-use" disabled={busy !== null} aria-describedby={nameId} onClick={() => pick(t)}>
                  {busy === t.key ? words.choosing : t.key === scratchTemplate ? words.scratch : words.use}
                </button>
              </>
            )
          }}
        />
      )}
      <KeepWordsDialog template={asking} onCancel={() => setAsking(null)} onChoose={choose} />
    </div>
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
