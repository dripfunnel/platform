import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadStore, storeTabs } from '../../api/stores'
import { StoreLoading } from '../../features/stores/StoreDetail'
import { StoreDetailScreen, StoreRouteError } from '../../features/stores/StoreDetailScreen'

// `tab` is the page's own address for each section (§6.3); loose, so the harness keys stay.
export const Route = createFileRoute('/_app/stores_/$storeId')({
  validateSearch: z.looseObject({ tab: optionalParam(z.enum(storeTabs)) }),
  loader: ({ params, context }) => loadStore(params.storeId, context.me.role),
  pendingComponent: StoreLoading,
  errorComponent: StoreRouteError,
  component: StoreDetailScreen,
})
