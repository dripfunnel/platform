import { DetailTabs, EmptyState, ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { loadLocale, loadStoreInfo } from '../../api/settings'
import { loadApproval, loadPeople, loadSuppliers } from '../../api/team'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import '../common/pageTabs.css'
import { sampleReads, settingsStates, type SettingsReads } from './settingsStates'
import { StoreInfoTab } from './StoreInfoTab'
import { PeopleTab, SupplierTab } from './TeamTabs'
import './settings.css'

const words = messages.settings
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/settings')

/** The tabs built so far; each card adds its own (FIRST-RELEASE §15). */
export const settingsTabs = ['store', 'people', 'supplier'] as const
export type SettingsTab = (typeof settingsTabs)[number]

/** How a tab says something saved: a toast alone, or a toast and its reads again. */
interface Done {
  toast: (text: string) => void
  reload: (text: string) => void
}
/** What a tab shows once its reads are in. */
type Render = (done: Done, canEdit: boolean) => ReactNode
type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; render: Render }

const apiReads: SettingsReads = { storeInfo: loadStoreInfo, locale: loadLocale, people: loadPeople, suppliers: loadSuppliers, approval: loadApproval }

/** Each tab's reads, and what it shows with them. */
const loaders = (reads: SettingsReads): Record<SettingsTab, () => Promise<Render>> => ({
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

  const load = useCallback(() => {
    if (forced === 'loading') return setView({ kind: 'loading' })
    if (forced === 'error') return setView({ kind: 'error' })
    if (!allowed) return
    let live = true
    setView({ kind: 'loading' })
    void loaders(forced ? sampleReads : apiReads)[tab]().then(
      (render) => live && setView({ kind: 'ready', render }),
      () => live && setView({ kind: 'error' }),
    )
    return () => {
      live = false
    }
  }, [forced, allowed, tab])
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
          labels={{ store: words.tabs.store, people: words.tabs.people, supplier: words.tabs.supplier }}
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

