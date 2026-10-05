import { DetailTabs, EmptyState, ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadCollections, loadMarketCountries, type CollectionSummary } from '../../api/collections'
import { loadFilters, type Filter } from '../../api/filters'
import { loadMenu, type Menu } from '../../api/menu'
import { loadProductBasics } from '../../api/productEditor'
import { harnessEnabled } from '../../harness'
import { locale, messages } from '../../messages'
import { CollectionEditor } from './CollectionEditor'
import { CollectionList } from './CollectionList'
import { FiltersTab } from './FiltersTab'
import { MenuTab } from './MenuTab'
import { SizeChartsArea } from './SizeChartsArea'
import { collectionsAccess } from './collectionDraft'
import { collectionsStates, sampleChartReads, sampleCollections, sampleFilters, sampleMenu, sampleReads } from './collectionsStates'
import { seasonalFor, type SeasonKey } from './seasonal'
import '../common/pageTabs.css'
import './collections.css'

const words = messages.collections
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/collections')

export const collectionTabs = ['collections', 'filters', 'menus', 'sizeCharts'] as const
export type CollectionTab = (typeof collectionTabs)[number]

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; collections: CollectionSummary[]; filters: Filter[]; currency: string | null; seasonal: SeasonKey[] }
type MenuView = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; menu: Menu | null }

/** "Gifts under ₹999" in the empty state: a round amount in the store's own currency, never a country assumed. */
const giftPrice = (currency: string | null) =>
  currency ? new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(currency === 'INR' ? 999 : 50) : ''

/** The Collections area (CatCollections, FIRST-RELEASE §12): its tabs, and the list or a collection being edited. ?state= per collectionsStates.ts. */
export const CollectionsPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { edit, name, tab = 'collections' } = pageRoute.useSearch()
  const navigate = useNavigate()
  const forced = useScreenState(collectionsStates, harnessEnabled)
  const access = useMemo(() => {
    if (forced === 'denied') return { canRead: false, canEdit: false }
    if (forced === 'staff' || forced === 'readOnly') return { canRead: true, canEdit: false }
    return forced ? { canRead: true, canEdit: true } : collectionsAccess(acting, state?.readOnly ?? false)
  }, [forced, acting, state])
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [toast, setToast] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuView>({ kind: 'loading' })

  const load = useCallback(() => {
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (forced) return setView({ kind: 'ready', collections: forced === 'empty' ? [] : sampleCollections, filters: forced === 'empty' ? [] : sampleFilters, currency: 'INR', seasonal: ['navratri', 'diwali', 'weddingSeason'] })
    if (!access.canRead) return
    setView({ kind: 'loading' })
    // The seasonal ideas are a suggestion only: markets failing to load leaves them out, and nothing else.
    void Promise.all([loadCollections(), loadFilters(), loadProductBasics(), loadMarketCountries().catch(() => [])]).then(
      ([collections, filters, basics, countries]) => setView({ kind: 'ready', collections, filters, currency: basics.pricingCurrency, seasonal: seasonalFor(countries, new Date()) }),
      () => setView({ kind: 'error' }),
    )
  }, [forced, access.canRead])
  useEffect(load, [load])

  const loadMenuView = useCallback(() => {
    if (forced) return setMenu(forced === 'error' ? { kind: 'error' } : { kind: 'ready', menu: forced === 'empty' ? null : sampleMenu })
    setMenu({ kind: 'loading' })
    void loadMenu().then(
      (m) => setMenu({ kind: 'ready', menu: m }),
      () => setMenu({ kind: 'error' }),
    )
  }, [forced])
  useEffect(() => {
    if (tab === 'menus' && access.canRead) loadMenuView()
  }, [tab, access.canRead, loadMenuView])

  const done = (text: string) => {
    setToast(text)
    void navigate({ to: '/collections', search: tab === 'collections' ? {} : { tab } })
    load()
  }

  const body = () => {
    if (!access.canRead) return <EmptyState title={words.denied.title} body={words.denied.body} />
    // Size charts read their own lists; they don't wait on the collections.
    if (tab === 'sizeCharts') return <SizeChartsArea side="merchant" canEdit={access.canEdit} owner={acting.role === 'owner'} onToast={setToast} reads={forced ? sampleChartReads(forced) : undefined} />
    if (view.kind === 'loading') return <LoadingState label={words.loading} />
    if (view.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
    if (edit)
      return (
        <CollectionEditor
          key={edit}
          id={edit}
          suggested={edit === 'new' ? (name ?? null) : null}
          facets={view.filters}
          collections={view.collections}
          pricingCurrency={view.currency}
          canEdit={access.canEdit}
          onDone={done}
          {...(forced ? { reads: sampleReads } : {})}
        />
      )
    if (tab === 'filters')
      return (
        <FiltersTab
          filters={view.filters}
          collections={view.collections}
          canEdit={access.canEdit}
          onChanged={(text) => {
            setToast(text)
            load()
          }}
        />
      )
    if (tab === 'menus') {
      if (menu.kind === 'loading') return <LoadingState label={words.loading} />
      if (menu.kind === 'error') return <ErrorState title={words.menus.loadFailed.title} body={words.menus.loadFailed.body} retry={{ label: words.error.retry, onRetry: loadMenuView }} />
      return (
        <MenuTab
          key={menu.menu?.revision ?? 'none'}
          menu={menu.menu}
          collections={view.collections}
          storeName={acting.store.name}
          canEdit={access.canEdit}
          onSaved={setToast}
          onStale={(text) => {
            setToast(text)
            loadMenuView()
          }}
        />
      )
    }
    return (
      <CollectionList
        collections={view.collections}
        facets={view.filters}
        canEdit={access.canEdit}
        seasonal={view.seasonal}
        giftPrice={giftPrice(view.currency)}
        onCreate={(suggested) => void navigate({ to: '/collections', search: suggested ? { edit: 'new', name: suggested } : { edit: 'new' } })}
      />
    )
  }

  return (
    <div className="df-colls-page">
      <div className="df-page-tabs">
        <DetailTabs
          label={words.tabs.label}
          tabs={collectionTabs}
          labels={{ collections: words.tabs.collections, filters: words.tabs.filters, menus: words.tabs.menus, sizeCharts: words.tabs.sizeCharts }}
          current={tab}
          link={(target, props) => <Link to="/collections" search={target === 'collections' ? {} : { tab: target }} activeOptions={{ exact: true }} {...props} />}
        />
      </div>
      <div className="df-colls-body">{body()}</div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
