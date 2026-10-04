import { startExport, Toast, useExportJob, useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import { loadStores, setStoreBillingStatus, startStoresExport, type BillingStatus, type StoreFilter, type StoreRow } from '../../api/stores'
import { harnessEnabled } from '../../harness'
import { fill, messages } from '../../messages'
import { NotLive } from '../shell/NotLive'
import { Stores, StoresError, StoresLoading } from './Stores'
import { storesStates } from './storeHarness'
import { filterOf, withoutFilter } from './storeSearch'
import { exportKindOf, startedExport } from '../../api/exports'

const storesRoute = getRouteApi('/_app/stores')
const shellRoute = getRouteApi('/_app')

export const StoresScreen = () => {
  const page = storesRoute.useLoaderData()
  const search = storesRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(storesStates, harnessEnabled)
  const navigate = storesRoute.useNavigate()
  const router = useRouter()
  const job = useExportJob()
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const onFilterChange = useCallback((next: StoreFilter) => void navigate({ search: (prev) => ({ ...withoutFilter(prev), ...next }), replace: true }), [navigate])
  if (!page) return <NotLive what={messages.screens.stores.title} me={me} />
  const filter = filterOf(search)
  // The export job lives in the shell's store, so it keeps going and is announced after leaving this screen.
  const onExport = () => void startExport(startedExport('stores', startStoresExport(filter)))
  const onBillingStatus = (store: StoreRow, status: BillingStatus) =>
    setStoreBillingStatus(store.id, status)
      .then(async (result) => {
        if (!result.ok) return setToast(fill(messages.store.refused[result.reason], { verb: messages.store.verbs.billingStatus, name: store.name }))
        setToast(fill(messages.stores.billingStatus.set, { name: store.name, status: messages.stores.billingStatus.statuses[status] }))
        await router.invalidate()
      })
      .catch(() => setToast(messages.stores.billingStatus.failed))
  return (
    <>
      <Stores
        me={me}
        page={page}
        filter={filter}
        forced={forced}
        onFilterChange={onFilterChange}
        onReload={() => void router.invalidate()}
        loadMore={(after) => loadStores(filter, { after })}
        exportJob={exportKindOf(job) === 'activity' ? null : job}
        onExport={onExport}
        onBillingStatus={onBillingStatus}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

// While the loader runs, and when it throws: never the error's message, which can carry internals.
export const StoresPending = () => {
  const { me } = storesRoute.useRouteContext()
  return <StoresLoading product={me.partner.product} />
}

export const StoresRouteError = () => {
  const router = useRouter()
  const { me } = storesRoute.useRouteContext()
  return <StoresError product={me.partner.product} onRetry={() => void router.invalidate()} />
}
