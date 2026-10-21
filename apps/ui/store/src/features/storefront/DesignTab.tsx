import { ConfirmDialog, EmptyState } from '@dripfunnel/shared/ui'
import { Link } from '@tanstack/react-router'
import { useCallback, useRef, useState } from 'react'
import type { StorefrontMeters, StorefrontOverview } from '../../api/storefront'
import { fill, formatTime, messages } from '../../messages'
import { LiveFrame, liveDevices, type LiveDevice } from './LiveFrame'
import { canFrameLive, discardRefusal, rolledBackNotice } from './overviewView'
import { PublishNowBar } from './PublishNowBar'
import type { StorefrontApi } from './storefrontApi'

const words = messages.storefront.overview
const screenWords = messages.storefront.studio

/** The footer's "Powered by" line while the plan keeps it; `removable` when another plan takes it off. */
export interface PoweredLine {
  brand: string
  plan: string
  removable: boolean
}

export interface DesignTabProps {
  overview: StorefrontOverview
  catalogue: StorefrontMeters['catalogue'] | null
  host: string | null
  canEdit: boolean
  canUpgrade: boolean
  run: string | null
  onRun: (id: string | null) => void
  onPublished: (toast: string | null) => void
  powered: PoweredLine | null
  api: StorefrontApi
  onOverview: (next: StorefrontOverview) => void
  onToast: (text: string) => void
  onStudio: () => void
}

/** The Design tab's overview (PortalStorefront › Overview; FIRST-RELEASE §14). */
export const DesignTab = ({ overview, catalogue, host, canEdit, canUpgrade, run, onRun, onPublished, powered, api, onOverview, onToast, onStudio }: DesignTabProps) => {
  const [asking, setAsking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [device, setDevice] = useState<LiveDevice>('desktop')
  // The address a frame failed to load, so a new live address gets its own try.
  const [failedHost, setFailedHost] = useState<string | null>(null)
  const onFrameFail = useCallback(() => setFailedHost(host), [host])
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
  const framed = live !== null && host !== null && host !== failedHost && canFrameLive(live.portalOrigin, window.location.origin)
  const rolledBack = rolledBackNotice(overview)
  return (
    <div className="df-sf-design">
      {rolledBack && (
        <p className="df-sf-rolled-back" role="alert">
          {rolledBack}
        </p>
      )}
      {overview.live && catalogue && <PublishNowBar catalogue={catalogue} canEdit={canEdit} canUpgrade={canUpgrade} api={api} run={run} onRun={onRun} onDone={onPublished} />}
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
          {canEdit && (
            <button type="button" className="df-button df-sf-draft-button df-sf-draft-button--strong" onClick={onStudio}>
              {words.continueStudio}
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
            {framed ? (
              <div className="df-sf-devices" role="group" aria-label={screenWords.screen}>
                {liveDevices.map((d) => (
                  <button key={d} type="button" aria-pressed={device === d} onClick={() => setDevice(d)}>
                    {screenWords.devices[d]}
                  </button>
                ))}
              </div>
            ) : (
              <span className="df-sf-lede">{fill(words.published, { when: formatTime(live.publishedAt) })}</span>
            )}
          </div>
          {framed && host ? <LiveFrame key={host} host={host} device={device} onFail={onFrameFail} /> : host && <p className="df-sf-live-body">{fill(words.liveAt, { host })}</p>}
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
