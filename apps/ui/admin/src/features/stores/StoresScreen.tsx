import { getRouteApi, useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import type { StoreFilter } from '../../api/stores'
import { Toast } from '../common/Toast'
import { useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { storesStates } from './storeHarness'
import { Stores, StoresError } from './Stores'

const storesRoute = getRouteApi('/_app/stores')
const shellRoute = getRouteApi('/_app')

export const StoresScreen = () => {
  const page = storesRoute.useLoaderData()
  const { partner, status, storefront, setup, created, q } = storesRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(storesStates, harnessEnabled)
  const navigate = storesRoute.useNavigate()
  const router = useRouter()
  const arrived = useRouterState({ select: (state) => state.location.state.toast })
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  // Shown once: the message is taken out of the history entry, so Back or a reload doesn't
  // repeat it.
  useEffect(() => {
    if (!arrived) return
    setToast(arrived)
    void navigate({ search: (search) => search, state: {}, replace: true })
  }, [arrived, navigate])
  // A new filter starts from the first page, so the cursors are dropped with the old one.
  const onFilterChange = useCallback((next: StoreFilter) => void navigate({ search: next, replace: true }), [navigate])
  const filter: StoreFilter = {
    ...(partner ? { partner } : {}),
    ...(status ? { status } : {}),
    ...(storefront ? { storefront } : {}),
    ...(setup ? { setup } : {}),
    ...(created ? { created } : {}),
    ...(q ? { q } : {}),
  }
  return (
    <>
      <Stores
        page={page}
        filter={filter}
        forced={forced}
        readOnly={me.role === 'staff-read-only' || forced === 'readonly'}
        onFilterChange={onFilterChange}
        onReload={() => void router.invalidate()}
      />
      <Toast message={toast} onDone={clearToast} />
    </>
  )
}

// The route's error view: it never shows the thrown error, whose message can carry internals.
export const StoresRouteError = () => {
  const router = useRouter()
  return <StoresError onRetry={() => void router.invalidate()} />
}
