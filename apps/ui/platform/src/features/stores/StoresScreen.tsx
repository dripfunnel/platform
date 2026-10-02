import { useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import { loadStores, type StoreFilter } from '../../api/stores'
import { harnessEnabled } from '../../harness'
import { messages } from '../../messages'
import { NotLive } from '../shell/NotLive'
import { Stores, StoresError, StoresLoading } from './Stores'
import { storesStates } from './storeHarness'
import { filterOf, withoutFilter } from './storeSearch'

const storesRoute = getRouteApi('/_app/stores')
const shellRoute = getRouteApi('/_app')

export const StoresScreen = () => {
  const page = storesRoute.useLoaderData()
  const search = storesRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(storesStates, harnessEnabled)
  const navigate = storesRoute.useNavigate()
  const router = useRouter()
  const onFilterChange = useCallback((next: StoreFilter) => void navigate({ search: (prev) => ({ ...withoutFilter(prev), ...next }), replace: true }), [navigate])
  if (!page) return <NotLive what={messages.screens.stores.title} me={me} />
  const filter = filterOf(search)
  return (
    <Stores
      me={me}
      page={page}
      filter={filter}
      forced={forced}
      onFilterChange={onFilterChange}
      onReload={() => void router.invalidate()}
      loadMore={(after) => loadStores(filter, { after }, me.role)}
    />
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
