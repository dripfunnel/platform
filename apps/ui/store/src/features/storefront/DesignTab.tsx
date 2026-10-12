import { ConfirmDialog, EmptyState } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useRef, useState } from 'react'
import type { StorefrontOverview } from '../../api/storefront'
import { fill, formatTime, messages } from '../../messages'
import { discardRefusal } from './overviewView'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.overview

/** The footer's "Powered by" line while the plan keeps it; `removable` when another plan takes it off. */
export interface PoweredLine {
  brand: string
  plan: string
  removable: boolean
}

export interface DesignTabProps {
  overview: StorefrontOverview
  host: string | null
  canEdit: boolean
  powered: PoweredLine | null
  api: StorefrontApi
  onOverview: (next: StorefrontOverview) => void
  onToast: (text: string) => void
}

/** The Design tab's overview (PortalStorefront › Overview; FIRST-RELEASE §14). */
export const DesignTab = ({ overview, host, canEdit, powered, api, onOverview, onToast }: DesignTabProps) => {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const working = useRef(false)

  const discard = () => {
    setAsking(false)
    if (working.current) return
    working.current = true
    setBusy(true)
    setError(null)
    api
      .discardDraft()
      .then(() => api.loadOverview())
      .then(
        (next) => {
          onOverview(next)
          onToast(words.discarded)
        },
        (e: unknown) => setError(discardRefusal(e)),
      )
      .finally(() => {
        working.current = false
        setBusy(false)
      })
  }

  if (overview.status === 'creating')
    return (
      <div className="df-sf-design" role="status">
        <EmptyState title={words.creatingTitle} body={words.creatingBody} />
      </div>
    )
  const { live } = overview
  return (
    <div className="df-sf-design">
      {overview.status === 'unpublished_changes' && (
        <div className="df-sf-draft">
          <p>
            <strong>{words.draftTitle}</strong> {words.draftBody}
          </p>
          {canEdit && (
            <button type="button" className="df-button df-sf-draft-button" disabled={busy} onClick={() => {
                setError(null)
                setAsking(true)
              }}>
              {words.discard}
            </button>
          )}
          {error && (
            <p className="df-sf-problem" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
      {live ? (
        <section className="df-sf-live" aria-label={fill(words.liveLabel, { number: String(live.number) })}>
          <div className="df-sf-live-head">
            <span className="df-sf-eyebrow">{fill(words.liveLabel, { number: String(live.number) })}</span>
            <span className="df-sf-lede">{fill(words.published, { when: formatTime(live.publishedAt) })}</span>
          </div>
          {/* Live pages refuse every frame (storefront ARCHITECTURE §3.5), so the site opens in its own tab instead. */}
          {host && <p className="df-sf-live-body">{fill(words.liveAt, { host })}</p>}
          {powered && (
            <p className="df-sf-powered">
              <span>{fill(words.powered, { brand: powered.brand, plan: powered.plan })}</span>
              {powered.removable && (
                <Link className="df-sf-link" to="/billing">
                  {words.poweredRemove}
                </Link>
              )}
            </p>
          )}
        </section>
      ) : canEdit ? (
        <EmptyState title={words.notPublishedTitle} body={words.notPublishedBody} />
      ) : (
        <EmptyState title={messages.storefront.design.noSiteTitle} body={messages.storefront.design.noSiteBody} />
      )}
      <ConfirmDialog
        open={asking}
        danger
        title={words.discardTitle}
        target={host ?? ''}
        consequence={words.discardBody}
        confirmLabel={words.discardConfirm}
        cancelLabel={words.cancel}
        onCancel={() => setAsking(false)}
        onConfirm={discard}
      />
    </div>
  )
}
