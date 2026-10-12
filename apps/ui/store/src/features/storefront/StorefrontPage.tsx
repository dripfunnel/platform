import { EmptyState, ErrorState, LoadingState, pollWhileVisible, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { scratchTemplate, type StorefrontBrand, type StorefrontDomains, type StorefrontOverview, type StorefrontSeo, type StorefrontTemplate } from '../../api/storefront'
import { currentBrand } from '../../brand/current'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, messages } from '../../messages'
import { isHttps } from '../common/https'
import { tabKeyHandler } from '../common/tabKeys'
import { BrandStep } from './BrandStep'
import { DesignTab, type PoweredLine } from './DesignTab'
import { hasSite, liveHost, needsTemplate, templateName } from './overviewView'
import { SiteSettingsTab } from './SiteSettingsTab'
import { storefrontAccessOf, storefrontTabs, type StorefrontTab } from './storefrontAccess'
import { sampleApi, storeApi } from './storefrontApi'
import { storefrontStates } from './storefrontStates'
import { TemplateGallery } from './TemplateGallery'
import './storefront.css'

const words = messages.storefront
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/storefront')

interface Reads {
  brand: StorefrontBrand | null
  seo: StorefrontSeo
  domains: StorefrontDomains
  overview: StorefrontOverview
  templates: StorefrontTemplate[]
}
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; reads: Reads }

// How often a site being made is read again until it is ready.
const creatingPollMs = 5_000

/** Storefront (PortalStorefront, FIRST-RELEASE §14): the brand step, the gallery, then Design · Pages · Journal · Site settings. ?state= per storefrontStates.ts. */
export const StorefrontPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { tab = 'design', view: shown } = pageRoute.useSearch()
  const navigate = useNavigate()
  const forced = useScreenState(storefrontStates, harnessEnabled)
  const access = useMemo(() => storefrontAccessOf(forced, acting, state?.readOnly ?? false), [forced, acting, state])
  const api = useMemo(() => (forced ? sampleApi(forced) : storeApi), [forced])
  const canUpgrade = forced !== null || acting.permissions.includes('billing')
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [toast, setToast] = useState<string | null>(null)
  const [powered, setPowered] = useState<PoweredLine | null>(null)

  // Only the newest read lands: a retry answered before a slow first read keeps its answer.
  const latest = useRef(0)
  const load = useCallback(() => {
    const ask = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (!access.canRead) return
    setView({ kind: 'loading' })
    void Promise.all([api.loadBrand(), api.loadSeo(), api.loadDomains(), api.loadOverview(), api.loadTemplates()]).then(
      ([brand, seo, domains, overview, templates]) => ask === latest.current && setView({ kind: 'ready', reads: { brand, seo, domains, overview, templates } }),
      () => ask === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, access.canRead, api])
  useEffect(load, [load])

  const update = useCallback((patch: Partial<Reads>) => setView((v) => (v.kind === 'ready' ? { kind: 'ready', reads: { ...v.reads, ...patch } } : v)), [])
  const onDomains = useCallback((domains: StorefrontDomains) => update({ domains }), [update])
  // A changed design can change which template is the current look, so the gallery's list is read again with it.
  const templatesAsk = useRef(0)
  const onOverview = useCallback(
    (overview: StorefrontOverview) => {
      update({ overview })
      const ask = ++templatesAsk.current
      api.loadTemplates().then(
        (templates) => ask === templatesAsk.current && update({ templates }),
        () => undefined,
      )
    },
    [update, api],
  )

  // The footer's "Powered by" needs the plan, which only the Owner reads (`billing`); a failed read just leaves the line out.
  const brandName = currentBrand()?.poweredBy ? (currentBrand()?.productName ?? null) : null
  const planName = acting.plan?.name ?? null
  useEffect(() => {
    if (!canUpgrade || !access.canRead || brandName === null || planName === null) return
    let current = true
    api.loadPoweredBy().then(
      ({ removed, removable }) => current && setPowered(removed ? null : { brand: brandName, plan: planName, removable }),
      () => current && setPowered(null),
    )
    return () => {
      current = false
    }
  }, [api, canUpgrade, access.canRead, brandName, planName])

  // While the site is being made, its status is read again until it is ready; only the newest answer lands.
  const creating = view.kind === 'ready' && view.reads.overview.status === 'creating'
  useEffect(() => {
    if (!creating) return
    let asked = 0
    return pollWhileVisible(
      () => {
        const ask = ++asked
        api.loadOverview().then(
          (overview) => ask === asked && update({ overview }),
          () => undefined,
        )
      },
      creatingPollMs,
      { doc: document, win: window },
    )
  }, [creating, api, update])

  const tabsId = useId()
  const tabRefs = useRef<Partial<Record<StorefrontTab, HTMLButtonElement | null>>>({})
  const goTab = (next: StorefrontTab) => void navigate({ to: '/storefront', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), tab: next === 'design' ? undefined : next }), replace: true })
  const goView = (next: 'gallery' | undefined) => void navigate({ to: '/storefront', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), tab: undefined, view: next }) })
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

  const { brand, seo, domains, overview, templates } = view.reads
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

  if (access.canEdit && (needsTemplate(overview.status) || (shown === 'gallery' && hasSite(overview.status))))
    return (
      <>
        <TemplateGallery
          templates={templates}
          status={overview.status}
          api={api}
          onBack={hasSite(overview.status) ? () => goView(undefined) : null}
          onChosen={(chosen, status) => {
            setToast(fill(chosen.key === scratchTemplate ? messages.storefront.gallery.scratchStarted : messages.storefront.gallery.switched, { name: chosen.name }))
            const ask = ++latest.current
            void Promise.all([api.loadOverview(), api.loadTemplates()]).then(
              ([next, list]) => ask === latest.current && update({ overview: next, templates: list }),
              () => ask === latest.current && update({ overview: { ...overview, status } }),
            )
            goView(undefined)
          }}
        />
        <Toast message={toast} onDone={() => setToast(null)} />
      </>
    )

  const host = liveHost(domains)
  const { live } = overview
  const liveUrl = live && host && isHttps(`https://${host}`) ? `https://${host}` : null

  const panel = () => {
    if (tab === 'pages') return <EmptyState title={words.pages.title} body={words.pages.body} />
    if (tab === 'journal') return <EmptyState title={words.journal.title} body={words.journal.body} />
    if (tab === 'settings')
      return (
        <SiteSettingsTab
          brand={brand}
          seo={seo}
          domains={domains}
          canEdit={access.canEdit}
          canUpgrade={canUpgrade}
          api={api}
          onBrand={(saved, text) => {
            update({ brand: saved })
            setToast(text)
          }}
          onSeo={(saved, text) => {
            update({ seo: saved })
            setToast(text)
          }}
          onDomains={onDomains}
          onToast={setToast}
        />
      )
    return <DesignTab overview={overview} host={host} canEdit={access.canEdit} powered={powered} api={api} onOverview={onOverview} onToast={setToast} />
  }

  return (
    <div className="df-sf">
      <header className="df-sf-top">
        <div className="df-sf-head">
          {title}
          <p className="df-sf-sub">{live ? fill(words.overview.liveLine, { host: host ?? '', number: String(live.number), template: templateName(templates, live.template) }) : words.overview.notLive}</p>
        </div>
        <div className="df-sf-top-actions">
          {liveUrl && (
            <a className="df-button" href={liveUrl} target="_blank" rel="noopener noreferrer">
              {words.overview.viewLive}
            </a>
          )}
          {access.canEdit && hasSite(overview.status) && (
            <button type="button" className="df-button" onClick={() => goView('gallery')}>
              {words.overview.changeTemplate}
            </button>
          )}
        </div>
      </header>
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
