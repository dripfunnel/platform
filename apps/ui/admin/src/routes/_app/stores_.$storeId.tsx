import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadMe } from '../../api/me'
import { loadStore } from '../../api/stores'
import { callerFor } from '../../features/common/harnessCaller'
import { optionalParam } from '../../features/common/searchParams'
import { StoreLoading } from '../../features/stores/StoreDetail'
import { StoreDetailScreen, StoreRouteError } from '../../features/stores/StoreDetailScreen'
import { storeTabs } from '../../features/stores/StoreTabs'

export const Route = createFileRoute('/_app/stores_/$storeId')({
  validateSearch: z.object({ tab: optionalParam(z.enum(storeTabs)) }),
  loader: async ({ params, location }) => {
    const me = await loadMe()
    return loadStore(params.storeId, callerFor(me.role, location.searchStr))
  },
  pendingComponent: StoreLoading,
  errorComponent: StoreRouteError,
  component: StoreDetailScreen,
})
