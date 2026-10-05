import { DetailTabs, EmptyState, ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { loadAllMarkets } from '../../api/markets'
import { loadProductBasics } from '../../api/productEditor'
import { loadLocale, loadStoreInfo } from '../../api/settings'
import { loadInvoiceSettings, loadTax } from '../../api/tax'
import { loadApproval, loadPeople, loadSuppliers } from '../../api/team'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import '../common/pageTabs.css'
import { sampleReads, settingsStates, type SettingsReads } from './settingsStates'
import { StoreInfoTab } from './StoreInfoTab'
import { CatalogueTab } from './CatalogueTab'
import { MarketsTab } from './MarketsTab'
import { TaxTab } from './TaxTab'
import { PeopleTab, SupplierTab } from './TeamTabs'
import { WarehousesView } from '../warehouses/WarehousesView'
import './settings.css'

const words = messages.settings
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/settings')

/** The tabs built so far; each card adds its own (FIRST-RELEASE §15). */
export const settingsTabs = ['store', 'people', 'supplier', 'warehouse', 'tax', 'markets', 'catalogue'] as const
export type SettingsTab = (typeof settingsTabs)[number]

/** How a tab says something saved: a toast alone, or a toast and its reads again. */
interface Done {
  toast: (text: string) => void
  reload: (text: string) => void
}
/** What a tab shows once its reads are in. */
type Render = (done: Done, canEdit: boolean) => ReactNode
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; render: Render }

const apiReads: SettingsReads = { storeInfo: loadStoreInfo, locale: loadLocale, people: loadPeople, suppliers: loadSuppliers, approval: loadApproval, tax: loadTax, invoice: loadInvoiceSettings, markets: loadAllMarkets, catalogue: loadProductBasics }

/** Each tab's reads, and what it shows with them. */
const loaders = (reads: SettingsReads, seat: { planName: string | null; owner: boolean }): Record<SettingsTab, () => Promise<Render>> => ({
  store: async () => {
    const [info, locale] = await Promise.all([reads.storeInfo(), reads.locale()])
    if (!info || !locale) throw new Error('store info missing')
    // Each card keeps what it saved; reading the tab again would throw away what's typed in the other two.
    return (done, canEdit) => <StoreInfoTab info={info} locale={locale} canEdit={canEdit} onSaved={done.toast} />
  },
  people: async () => {
    const people = await reads.people()
    return (done, canEdit) => <PeopleTab people={people} canEdit={canEdit} onChanged={done.reload} />
  },
  supplier: async () => {
    const [suppliers, approval] = await Promise.all([reads.suppliers(), reads.approval()])
    return (done, canEdit) => <SupplierTab suppliers={suppliers} approval={approval} canEdit={canEdit} onChanged={done.reload} />
  },
  // The store's locations, and its suppliers' named, read-only (SetOps "Warehouse").
  warehouse: async () => {
    const names = new Map((await reads.suppliers()).map((s) => [s.id, s.name]))
    return (_, canEdit) => <WarehousesView canEdit={canEdit} supplierNames={names} />
  },
  tax: async () => {
    const [tax, invoice, info] = await Promise.all([reads.tax(), reads.invoice(), reads.storeInfo()])
    if (!tax || !invoice) throw new Error('tax setup missing')
    return (done, canEdit) => <TaxTab tax={tax} invoice={invoice} country={info?.country ?? null} taxId={info?.taxId ?? null} canEdit={canEdit} onSaved={done.toast} onChanged={done.reload} />
  },
  // Each save answers the market as stored, so the tab keeps its own list rather than reading again.
  markets: async () => {
    const [markets, locale] = await Promise.all([reads.markets(), reads.locale()])
    if (!locale) throw new Error('locale missing')
    return (done, canEdit) => <MarketsTab markets={markets} locale={locale} canEdit={canEdit} onSaved={done.toast} />
  },
  catalogue: async () => {
    const basics = await reads.catalogue()
    return (done, canEdit) => <CatalogueTab basics={basics} planName={seat.planName} owner={seat.owner} canEdit={canEdit} onSaved={done.toast} onChanged={done.reload} />
  },
})

/** Settings (PortalSettings, FIRST-RELEASE §15): the Owner's, one tab at a time. ?state= per settingsStates.ts. */
export const SettingsPage = () => {
  const { acting, state } = shellRoute.useLoaderData()
  const { tab = 'store' } = pageRoute.useSearch()
  const forced = useScreenState(settingsStates, harnessEnabled)
  const allowed = forced ? forced !== 'denied' : acting.permissions.includes('settings')
  const readOnly = forced ? forced === 'readOnly' : (state?.readOnly ?? false)
  const [view, setView] = useState<View>({ kind: 'loading' })
  const [toast, setToast] = useState<string | null>(null)

  // Only the newest read may land: a reload a tab started must not fill another tab opened since.
  const latest = useRef(0)
  const load = useCallback(() => {
    const ask = ++latest.current
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (!allowed) return
    setView({ kind: 'loading' })
    void loaders(forced ? sampleReads : apiReads, { planName: acting.plan?.name ?? null, owner: acting.role === 'owner' })[tab]().then(
      (render) => ask === latest.current && setView({ kind: 'ready', render }),
      () => ask === latest.current && setView({ kind: 'error' }),
    )
  }, [forced, allowed, tab, acting])
  useEffect(load, [load])

  const done: Done = {
    toast: setToast,
    reload: (text) => {
      setToast(text)
      load()
    },
  }

  const body = () => {
    if (!allowed) return <EmptyState title={words.denied.title} body={words.denied.body} />
    if (view.kind === 'loading') return <LoadingState label={words.loading} />
    if (view.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
    return view.render(done, !readOnly)
  }

  return (
    <div className="df-settings">
      <div className="df-page-tabs">
        <DetailTabs
          label={words.tabs.label}
          tabs={settingsTabs}
          labels={{ store: words.tabs.store, people: words.tabs.people, supplier: words.tabs.supplier, warehouse: words.tabs.warehouse, tax: words.tabs.tax, markets: words.tabs.markets, catalogue: words.tabs.catalogue }}
          current={tab}
          link={(target, props) => <Link to="/settings" search={target === 'store' ? {} : { tab: target }} activeOptions={{ exact: true }} {...props} />}
        />
      </div>
      {allowed && readOnly && <p className="df-set-readonly">{words.readOnly}</p>}
      {body()}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}

