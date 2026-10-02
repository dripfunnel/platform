import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadStore } from '../../api/stores'
import { customerFilterSearch } from '../../features/customers/customerSearch'
import { activityTabSearch } from '../../features/common/activitySearch'
import { optionalParam } from '@dripfunnel/shared/search'
import { StoreLoading } from '../../features/stores/StoreDetail'
import { StoreDetailScreen, StoreRouteError } from '../../features/stores/StoreDetailScreen'
import { storeTabs } from '../../features/stores/StoreTabs'

export const Route = createFileRoute('/_app/stores_/$storeId')({
  // The Customers tab keeps its filters in the store's URL too (#42).
  validateSearch: z.object({ tab: optionalParam(z.enum(storeTabs)), ...customerFilterSearch, ...activityTabSearch }),
  loader: ({ params }) => loadStore(params.storeId),
  pendingComponent: StoreLoading,
  errorComponent: StoreRouteError,
  component: StoreDetailScreen,
})
