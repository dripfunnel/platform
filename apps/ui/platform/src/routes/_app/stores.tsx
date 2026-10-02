import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createdWindows, loadStores, storefrontStates, storeStatuses } from '../../api/stores'
import { StoresPending, StoresRouteError, StoresScreen } from '../../features/stores/StoresScreen'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6). Loose, so the
// harness keys survive a filter change.
const storesSearch = z.looseObject({
  status: optionalParam(z.enum(storeStatuses)),
  plan: idParam,
  created: optionalParam(z.enum(createdWindows)),
  storefront: optionalParam(z.enum(storefrontStates)),
  near: optionalParam(z.literal('yes')),
  q: searchParam,
})

export const Route = createFileRoute('/_app/stores')({
  validateSearch: storesSearch,
  loaderDeps: ({ search: { status, plan, created, storefront, near, q } }) => ({ status, plan, created, storefront, near, q }),
  // The first page; "Show 25 more" appends the next in place (§16). Only a Live partner has a list (§1).
  loader: ({ context, deps }) => (context.me.partner.state === 'live' ? loadStores(deps, {}, context.me.role) : Promise.resolve(null)),
  pendingComponent: StoresPending,
  errorComponent: StoresRouteError,
  component: StoresScreen,
})
