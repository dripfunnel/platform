import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadMe } from '../../api/me'
import { loadStore } from '../../api/stores'
import { callerFor } from '../../features/common/harnessCaller'
import { customerFilterSearch } from '../../features/customers/customerSearch'
import { optionalParam } from '../../features/common/searchParams'
import { StoreLoading } from '../../features/stores/StoreDetail'
import { StoreDetailScreen, StoreRouteError } from '../../features/stores/StoreDetailScreen'
import { storeTabs } from '../../features/stores/StoreTabs'

export const Route = createFileRoute('/_app/stores_/$storeId')({
  // The Customers tab keeps its filters in the store's URL too (#42).
  validateSearch: z.object({ tab: optionalParam(z.enum(storeTabs)), ...customerFilterSearch }),
  loader: async ({ params, location }) => {
    const me = await loadMe()
    return loadStore(params.storeId, callerFor(me.role, location.searchStr))
  },
  pendingComponent: StoreLoading,
  errorComponent: StoreRouteError,
  component: StoreDetailScreen,
})
