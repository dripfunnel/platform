import { EmptyState, ErrorState, LoadingState, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { loadTemplates, scratchTemplate, type StorefrontTemplate } from '../../api/storefront'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { demoUrlOf, TemplateList } from '../storefront/TemplateList'
import '../storefront/storefront.css'
import { templateStates } from './templateStates'

const words = messages.templates
const shellRoute = getRouteApi('/_app')

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; templates: StorefrontTemplate[] }

// "Start from scratch" is a blank page that never has a demo (admin FIRST-RELEASE §11d), so the showroom leaves it out.
const showroom = (templates: readonly StorefrontTemplate[]) => templates.filter((t) => t.key !== scratchTemplate)
const noneCurrent = () => false

/** A card's one action: its demo in a new tab, or "Demo coming soon" until it has one. */
const previewOf = (template: StorefrontTemplate) => {
  const demo = demoUrlOf(template)
  return demo ? (
    <a className="df-button df-sf-use" href={demo} target="_blank" rel="noopener noreferrer" aria-label={fill(words.previewLabel, { name: template.name })}>
      {words.preview}
    </a>
  ) : (
    <button type="button" className="df-button df-sf-use" disabled>
      {words.soon}
    </button>
  )
}

/** Templates (#1733, FIRST-RELEASE §14): every template's demo to look at; it reads nothing of this store and changes nothing. */
export const TemplatesPage = () => {
  const { acting } = shellRoute.useLoaderData()
  const forced = useScreenState(templateStates, harnessEnabled)
  const canRead = forced !== 'denied' && acting.seller === null && acting.permissions.includes('storefront.read')
  const [view, setView] = useState<View>({ kind: 'loading' })

  const load = useCallback(() => {
    if (!canRead) return
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (forced === 'empty') return setView({ kind: 'ready', templates: [] })
    setView({ kind: 'loading' })
    loadTemplates().then(
      (templates) => setView({ kind: 'ready', templates: showroom(templates) }),
      () => setView({ kind: 'error' }),
    )
  }, [canRead, forced])
  useEffect(load, [load])

  return (
    <div className="df-sf df-sf-gallery">
      <header className="df-sf-head">
        <h1 className="df-sf-title">{words.title}</h1>
        <p className="df-sf-sub">{words.lede}</p>
      </header>
      {!canRead ? (
        <EmptyState title={words.denied.title} body={words.denied.body} />
      ) : view.kind === 'loading' ? (
        <LoadingState label={words.loading} />
      ) : view.kind === 'error' ? (
        <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
      ) : view.templates.length === 0 ? (
        <EmptyState title={words.emptyTitle} body={words.emptyBody} />
      ) : (
        <TemplateList templates={view.templates} isCurrent={noneCurrent} actions={previewOf} />
      )}
    </div>
  )
}