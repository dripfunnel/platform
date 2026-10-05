import { DetailTabs, EmptyState, ErrorState, LoadingState, Toast, useScreenState } from '@dripfunnel/shared/ui'
import '@dripfunnel/shared/ui/detail.css'
import '@dripfunnel/shared/ui/states.css'
import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import { loadLocale, loadStoreInfo, type StoreInfo, type StoreLocale } from '../../api/settings'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { sampleInfo, sampleLocale, settingsStates } from './settingsStates'
import { StoreInfoTab } from './StoreInfoTab'
import '../common/pageTabs.css'
import './settings.css'

const words = messages.settings
const shellRoute = getRouteApi('/_app')
const pageRoute = getRouteApi('/_app/settings')

/** The tabs built so far; each card adds its own (FIRST-RELEASE §15). */
export const settingsTabs = ['store'] as const
export type SettingsTab = (typeof settingsTabs)[number]

type View = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; info: StoreInfo; locale: StoreLocale }

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
    if (forced && sampleInfo && sampleLocale) return setView({ kind: 'ready', info: sampleInfo, locale: sampleLocale })
    if (!allowed) return
    setView({ kind: 'loading' })
    void Promise.all([loadStoreInfo(), loadLocale()]).then(
      ([info, locale]) => (info && locale ? setView({ kind: 'ready', info, locale }) : setView({ kind: 'error' })),
      () => setView({ kind: 'error' }),
    )
  }, [forced, allowed])
  useEffect(load, [load])

  const body = () => {
    if (!allowed) return <EmptyState title={words.denied.title} body={words.denied.body} />
    if (view.kind === 'loading') return <LoadingState label={words.loading} />
    if (view.kind === 'error') return <ErrorState title={words.error.title} body={words.error.body} retry={{ label: words.error.retry, onRetry: load }} />
    // Each card keeps what it saved; reading the tab again would throw away what's typed in the other two.
    return <StoreInfoTab info={view.info} locale={view.locale} canEdit={!readOnly} onSaved={setToast} />
  }

  return (
    <div className="df-settings">
      <div className="df-page-tabs">
        <DetailTabs label={words.tabs.label} tabs={settingsTabs} labels={{ store: words.tabs.store }} current={tab} link={(target, props) => <Link to="/settings" search={target === 'store' ? {} : { tab: target }} activeOptions={{ exact: true }} {...props} />} />
      </div>
      {allowed && readOnly && <p className="df-set-readonly">{words.readOnly}</p>}
      {body()}
      <Toast message={toast} onDone={() => setToast(null)} />
    </div>
  )
}
