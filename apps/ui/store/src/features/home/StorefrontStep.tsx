import { isHttps } from '@dripfunnel/shared/format'
import { useState } from 'react'
import { fill, messages } from '../../messages'
import { chooseRefusal } from '../storefront/overviewView'
import { previewRefusal, publishRefusal } from '../storefront/studioRules'
import type { StorefrontPhase, StorefrontSetup } from './homeView'

const words = messages.home.setup.storefront
const mark = messages.home.setup.mark

export interface SiteStep {
  /** Null while the site couldn't be read (`unavailable`). */
  setup: StorefrontSetup | null
  phase: StorefrontPhase
  onCreate: () => Promise<void>
  onRetry: () => Promise<void>
  /** The draft's signed preview link (PREVIEW §5 step 1). */
  onPreview: () => Promise<string>
  onPublish: () => Promise<void>
  /** Why the last publish didn't go live, in plain words. */
  refused: string | null
  /** The running publish couldn't be read for a while; Check again reads it again. */
  lost: boolean
  onCheckAgain: () => void
}

/** "Create your storefront" (FIRST-RELEASE §5): the first site from the category's template, previewed and published from Home. */
export const StorefrontStep = ({ label, site }: { label: string; site: SiteStep }) => {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { setup, phase } = site
  const act = (work: () => Promise<void>, refusal: (e: unknown) => string) => {
    setBusy(true)
    setError(null)
    work().then(
      () => setBusy(false),
      (e: unknown) => {
        setBusy(false)
        setError(refusal(e))
      },
    )
  }
  // The tab opens on the click, before the link is signed, so no pop-up blocker stops it; it carries nothing back.
  const preview = () => {
    setError(null)
    const tab = window.open('', '_blank')
    if (tab) tab.opener = null
    site.onPreview().then(
      (link) => {
        if (tab && isHttps(link)) tab.location.href = link
        else tab?.close()
      },
      (e: unknown) => {
        tab?.close()
        setError(previewRefusal(e))
      },
    )
  }
  const host = setup?.host ?? null
  const note = {
    locked: words.locked,
    ready: setup?.template ? fill(words.template, { name: setup.template.name }) : null,
    failed: words.failed,
    creating: words.creating,
    open: words.ready,
    publishing: site.lost ? words.lost : words.publishing,
    done: host ? fill(words.live, { host }) : null,
    unavailable: error ? null : words.unavailable,
  }[phase]
  const working = phase === 'creating' || (phase === 'publishing' && !site.lost)
  const problem = error ?? (phase === 'open' ? site.refused : null)

  return (
    <div className="df-home-step-choices">
      <span className="df-home-step-mark" aria-hidden="true">
        {phase === 'done' ? mark : ''}
      </span>
      <span className="df-home-step-text">
        <span className="df-home-step-label">{label}</span>
        {note && (
          <span className="df-home-step-note" role={working ? 'status' : undefined}>
            {working && <span className="df-home-step-spinner" aria-hidden="true" />}
            {note}
          </span>
        )}
        {problem && (
          <span className="df-home-step-owner" role="alert">
            {problem}
          </span>
        )}
      </span>
      <span className="df-home-step-actions">
        {phase === 'done' ? (
          host && (
            <a className="df-button" href={`https://${host}`} target="_blank" rel="noopener noreferrer">
              {words.viewLive}
            </a>
          )
        ) : phase === 'open' || phase === 'publishing' ? (
          <>
            {setup?.previewReady && (
              <button type="button" className="df-button" onClick={preview}>
                {words.preview}
              </button>
            )}
            {site.lost ? (
              <button type="button" className="df-button" onClick={site.onCheckAgain}>
                {words.checkAgain}
              </button>
            ) : (
              <button type="button" className="df-button df-button--primary" disabled={phase === 'publishing' || busy} onClick={() => act(site.onPublish, publishRefusal)}>
                {phase === 'publishing' || busy ? words.publishingCta : words.publish}
              </button>
            )}
          </>
        ) : phase === 'unavailable' ? (
          <button type="button" className="df-button" disabled={busy} onClick={() => act(site.onRetry, () => words.unavailable)}>
            {words.retry}
          </button>
        ) : (
          <button type="button" className="df-button df-button--primary" disabled={phase === 'locked' || phase === 'creating' || busy} onClick={() => act(site.onCreate, chooseRefusal)}>
            {phase === 'creating' || busy ? words.creatingCta : words.create}
          </button>
        )}
      </span>
    </div>
  )
}
