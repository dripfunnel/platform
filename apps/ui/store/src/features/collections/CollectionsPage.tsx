import { DetailTabs, EmptyState, ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadCollections, loadMarketCountries, type CollectionSummary } from '../../api/collections'
import { loadFacets, loadProductBasics, type Facet } from '../../api/productEditor'
import { harnessEnabled } from '../../harness'
import { locale, messages } from '../../messages'
import { CollectionEditor } from './CollectionEditor'
import { CollectionList } from './CollectionList'
import { collectionsAccess } from './collectionDraft'
import { collectionsStates, sampleCollections, sampleFacets, sampleReads } from './collectionsStates'
import { seasonalFor, type SeasonKey } from './seasonal'
import './collections.css'

const words = messages.collections
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/collections')

export const collectionTabs = ['collections'] as const
export type CollectionTab = (typeof collectionTabs)[number]

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; collections: CollectionSummary[]; facets: Facet[]; currency: string | null; seasonal: SeasonKey[] }

/** "Gifts under ₹999" in the empty state: a round amount in the store's own currency, never a country assumed. */
const giftPrice = (currency: string | null) =>
  currency ? new Intl.NumberFormat(locale, { style: 'currency', currency, maximumFractionDigits: 0 }).format(currency === 'INR' ? 999 : 50) : ''

/** The Collections area (CatCollections, FIRST-RELEASE §12): its tabs, and the list or a collection being edited. ?state= per collectionsStates.ts. */
export const CollectionsPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { edit, name } = pageRoute.useSearch()
  const navigate = useNavigate()
  const forced = useScreenState(collectionsStates, harnessEnabled)
  const access = useMemo(() => {
    if (forced === 'denied') return { canRead: false, canEdit: false }
    if (forced === 'staff' || forced === 'readOnly') return { canRead: true, canEdit: false }
    return forced ? { canRead: true, canEdit: true } : collectionsAccess(acting, state?.readOnly ?? false)
  }, [forced, acting, state])
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [toast, setToast] = useState<string | null>(null)

  const load = useCallback(() => {
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (forced) return setView({ kind: 'ready', collections: forced === 'empty' ? [] : sampleCollections, facets: sampleFacets, currency: 'INR', seasonal: ['navratri', 'diwali', 'weddingSeason'] })
    if (!access.canRead) return
    setView({ kind: 'loading' })
    // The seasonal ideas are a suggestion only: markets failing to load leaves them out, and nothing else.
    void Promise.all([loadCollections(), loadFacets(), loadProductBasics(), loadMarketCountries().catch(() => [])]).then(
      ([collections, facets, basics, countries]) => setView({ kind: 'ready', collections, facets, currency: basics.pricingCurrency, seasonal: seasonalFor(countries, new Date()) }),
      () => setView({ kind: 'error' }),
    )
  }, [forced, access.canRead])
  useEffect(load, [load])

  const done = (text: string) => {
    setToast(text)
    void navigate({ to: '/collections', search: {} })
    load()
  }

  const body = () => {
    if (!access.canRead) return <EmptyState title={words.denied.title} body={words.denied.body} />
    if (view.kind === 'loading') return <LoadingState label={words.loading} />
    if (view.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
    if (edit)
      return (
        <CollectionEditor
          key={edit}
          id={edit}
          suggested={edit === 'new' ? (name ?? null) : null}
          facets={view.facets}
          collections={view.collections}
          pricingCurrency={view.currency}
          canEdit={access.canEdit}
          onDone={done}
          {...(forced ? { reads: sampleReads } : {})}
        />
      )
    return (
      <CollectionList
        collections={view.collections}
        facets={view.facets}
        canEdit={access.canEdit}
        seasonal={view.seasonal}
        giftPrice={giftPrice(view.currency)}
        onCreate={(suggested) => void navigate({ to: '/collections', search: suggested ? { edit: 'new', name: suggested } : { edit: 'new' } })}
      />
    )
  }

  return (
    <div className="df-colls-page">
      <div className="df-colls-tabs">
        <DetailTabs label={words.tabs.label} tabs={collectionTabs} labels={{ collections: words.tabs.collections }} current="collections" link={(_, props) => <Link to="/collections" search={{}} {...props} />} />
      </div>
      <div className="df-colls-body">{body()}</div>
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
