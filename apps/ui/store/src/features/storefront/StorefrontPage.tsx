import { EmptyState, ErrorState, LoadingState, pollWhileVisible, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { scratchTemplate, type StorefrontBrand, type StorefrontDomains, type StorefrontOverview, type StorefrontMeters, type StorefrontSeo, type StorefrontTemplate } from '../../api/storefront'
import { currentBrand } from '../../brand/current'
import { harnessEnabled, harnessSearch } from '../../harness'
import { fill, messages } from '../../messages'
import { isHttps } from '../common/https'
import { tabKeyHandler } from '../common/tabKeys'
import { BrandStep } from './BrandStep'
import { ContentTab } from './ContentTab'
import { DesignTab, type PoweredLine } from './DesignTab'
import { hasSite, liveHost, needsTemplate, templateName } from './overviewView'
import { SiteSettingsTab } from './SiteSettingsTab'
import { StudioView } from './StudioView'
import { storefrontAccessOf, storefrontTabs, type StorefrontTab, type StorefrontView } from './storefrontAccess'
import { sampleApi, storeApi } from './storefrontApi'
import { isStudioState, storefrontStates } from './storefrontStates'
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
  /** Null when the meters couldn't be read: the bar and the use card are left out, the rest of the page stays. */
  meters: StorefrontMeters | null
}
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; reads: Reads }

// How often a site being made is read again until it is ready.
const creatingPollMs = 5_000

/** Storefront (PortalStorefront, FIRST-RELEASE §14): the brand step, the gallery, then Design · Pages · Journal · Site settings. ?state= per storefrontStates.ts. */
export const StorefrontPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { tab = 'design', view: shown, run, page, entry } = pageRoute.useSearch()
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
    void Promise.all([api.loadBrand(), api.loadSeo(), api.loadDomains(), api.loadOverview(), api.loadTemplates(), api.loadMeters().catch(() => null)]).then(
      ([brand, seo, domains, overview, templates, meters]) => ask === latest.current && setView({ kind: 'ready', reads: { brand, seo, domains, overview, templates, meters } }),
      () => ask === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, access.canRead, api])
  useEffect(load, [load])

  const update = useCallback((patch: Partial<Reads>) => setView((v) => (v.kind === 'ready' ? { kind: 'ready', reads: { ...v.reads, ...patch } } : v)), [])
  const onDomains = useCallback((domains: StorefrontDomains) => update({ domains }), [update])
  const onRun = useCallback((next: string | null) => void navigate({ to: '/storefront', search: (prev) => ({ ...prev, run: next ?? undefined }), replace: true }), [navigate])

  // A changed design can change the current look, what waits for a publish and this month's use, so they are read again with it.
  const templatesAsk = useRef(0)
  const onOverview = useCallback(
    (overview: StorefrontOverview) => {
      update({ overview })
      const ask = ++templatesAsk.current
      Promise.all([api.loadTemplates(), api.loadMeters().catch(() => null)]).then(
        ([templates, meters]) => ask === templatesAsk.current && update({ templates, meters }),
        () => undefined,
      )
    },
    [update, api],
  )
  const refresh = useCallback(
    (text: string | null) => {
      if (text) setToast(text)
      api.loadOverview().then(onOverview, () => undefined)
    },
    [api, onOverview],
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
  const goView = (next: StorefrontView | undefined, path?: string) => void navigate({ to: '/storefront', search: (prev) => ({ ...harnessSearch(prev, forced ?? undefined), tab: undefined, view: next, page: path }) })
  const goEntry = (next: string | undefined) => void navigate({ to: '/storefront', search: (prev) => ({ ...prev, entry: next }) })
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

  const { brand, seo, domains, overview, templates, meters } = view.reads
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
            goView('studio')
          }}
        />
        <Toast message={toast} onDone={() => setToast(null)} />
      </>
    )

  const host = liveHost(domains)
  const { live } = overview
  const liveUrl = live && host && isHttps(`https://${host}`) ? `https://${host}` : null

  if (access.canEdit && (shown === 'studio' || isStudioState(forced)) && hasSite(overview.status))
    return (
      <StudioView
        overview={overview}
        templates={templates}
        storeName={brand?.shopName ?? acting.store.name}
        host={host}
        api={api}
        onExit={() => void navigate({ to: '/storefront', search: (prev) => ({ ...harnessSearch(prev, isStudioState(forced) ? 'draft' : (forced ?? undefined)), view: undefined, page: undefined }) })}
        onOverview={onOverview}
        usage={meters?.usage ?? null}
        run={run ?? (forced === 'pubChecking' || forced === 'pubRefused' || forced === 'rolledBack' ? 'sample-run' : null)}
        onRun={onRun}
        startPath={page ?? '/'}
      />
    )

  const panel = () => {
    if (tab === 'pages')
      return (
        <ContentTab
          kind="page"
          api={api}
          canEdit={access.canEdit}
          onStudio={access.canEdit && hasSite(overview.status) ? (path) => goView('studio', path) : null}
          entry={entry}
          onEntry={goEntry}
          host={host}
          shopName={brand?.shopName ?? acting.store.name}
          onToast={setToast}
        />
      )
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
          usage={meters?.usage ?? null}
          templates={templates}
          liveNumber={overview.live?.number ?? null}
          onWent={refresh}
        />
      )
    return (
      <DesignTab
        overview={overview}
        catalogue={meters?.catalogue ?? null}
        host={host}
        canEdit={access.canEdit}
        canUpgrade={canUpgrade}
        powered={powered}
        api={api}
        run={run ?? null}
        onRun={onRun}
        onPublished={refresh}
        onOverview={onOverview}
        onToast={setToast}
        onStudio={() => goView('studio')}
      />
    )
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
          {access.canEdit && hasSite(overview.status) && (
            <button type="button" className="df-button df-button--primary" onClick={() => goView('studio')}>
              {overview.status === 'unpublished_changes' ? words.overview.continueStudio : words.overview.openStudio}
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
