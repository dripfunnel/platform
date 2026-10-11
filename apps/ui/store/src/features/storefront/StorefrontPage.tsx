import { EmptyState, ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import type { StorefrontBrand, StorefrontSeo } from '../../api/storefront'
import { harnessEnabled, harnessSearch } from '../../harness'
import { messages } from '../../messages'
import { tabKeyHandler } from '../common/tabKeys'
import { BrandStep } from './BrandStep'
import { SiteSettingsTab } from './SiteSettingsTab'
import { storefrontAccessOf, storefrontTabs, type StorefrontTab } from './storefrontAccess'
import { sampleApi, storeApi } from './storefrontApi'
import { storefrontStates } from './storefrontStates'
import './storefront.css'

const words = messages.storefront
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/storefront')

interface Reads {
  brand: StorefrontBrand | null
  seo: StorefrontSeo
}
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; reads: Reads }

/** Storefront (PortalStorefront, FIRST-RELEASE §14): the brand step, then Design · Pages · Journal · Site settings. ?state= per storefrontStates.ts. */
export const StorefrontPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { tab = 'design' } = pageRoute.useSearch()
  const navigate = useNavigate()
  const forced = useScreenState(storefrontStates, harnessEnabled)
  const access = useMemo(() => storefrontAccessOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const api = useMemo(() => (forced ? sampleApi(forced) : storeApi), [forced])
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [toast, setToast] = useState<string | null>(null)

  // Only the newest read lands: a retry answered before a slow first read keeps its answer.
  const latest = useRef(0)
  const load = useCallback(() => {
    const ask = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (!access.canRead) return
    setView({ kind: 'loading' })
    void Promise.all([api.loadBrand(), api.loadSeo()]).then(
      ([brand, seo]) => ask === latest.current && setView({ kind: 'ready', reads: { brand, seo } }),
      () => ask === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, access.canRead, api])
  useEffect(load, [load])

  const update = useCallback((patch: Partial<Reads>) => setView((v) => (v.kind === 'ready' ? { kind: 'ready', reads: { ...v.reads, ...patch } } : v)), [])

  const tabsId = useId()
  const tabRefs = useRef<Partial<Record<StorefrontTab, HTMLButtonElement | null>>>({})
  const goTab = (next: StorefrontTab) => void navigate({ to: '/storefront', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), tab: next === 'design' ? undefined : next }), replace: true })
  const onTabKey = tabKeyHandler(storefrontTabs, tab, goTab, (next) => tabRefs.current[next]?.focus())

  const title = <h1 className="df-sf-title">{words.title}</h1>
  if (!access.canRead)
    return (
      <div className="df-sf">
        {title}
        <EmptyState title={words.denied.title} body={words.denied.body} />
      </div>
    )
  if (view.kind !== 'ready')
    return (
      <div className="df-sf">
        {title}
        {view.kind === 'loading' ? <LoadingState label={words.loading} /> : <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />}
      </div>
    )

  const { brand, seo } = view.reads
  if (access.canEdit && !brand?.brandReady)
    return (
      <div className="df-sf">
        <BrandStep
          brand={brand}
          seo={seo}
          api={api}
          onDone={(saved, savedSeo) => {
            update({ brand: saved, seo: savedSeo })
            setToast(words.brand.savedStep)
            goTab('design')
          }}
        />
        <Toast message={toast} onDone={() => setToast(null)} />
      </div>
    )

  const panel = () => {
    if (tab === 'pages') return <EmptyState title={words.pages.title} body={words.pages.body} />
    if (tab === 'journal') return <EmptyState title={words.journal.title} body={words.journal.body} />
    if (tab === 'settings')
      return (
        <SiteSettingsTab
          brand={brand}
          canEdit={access.canEdit}
          api={api}
          onBrand={(saved, text) => {
            update({ brand: saved })
            setToast(text)
          }}
        />
      )
    // Until the gallery and the studio (#318) are built, the Design tab says what comes next and draws no site.
    return access.canEdit ? (
      <EmptyState
        title={words.design.nextTitle}
        body={words.design.nextBody}
        action={
          <Link className="df-button" to="/storefront" search={(prev) => ({ ...harnessSearch(prev, forced ?? undefined), tab: 'settings' })} replace>
            {words.design.toSettings}
          </Link>
        }
      />
    ) : (
      <EmptyState title={words.design.noSiteTitle} body={words.design.noSiteBody} />
    )
  }

  return (
    <div className="df-sf">
      {title}
      {access.notice && (
        <p className="df-sf-notice" role="status">
          {words.notice[access.notice]}
        </p>
      )}
      <div className="df-sf-tabs" role="tablist" aria-label={words.tabs.label} onKeyDown={onTabKey}>
        {storefrontTabs.map((t) => (
          <button
            key={t}
            ref={(el) => {
              tabRefs.current[t] = el
            }}
            id={`${tabsId}-${t}`}
            type="button"
            role="tab"
            aria-selected={tab === t}
            aria-controls={`${tabsId}-panel`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => goTab(t)}
          >
            {words.tabs[t]}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${tabsId}-panel`} aria-labelledby={`${tabsId}-${tab}`} className="df-sf-panel">
        {panel()}
      </div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
