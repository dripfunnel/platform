import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { parseScreenState } from '@dripfunnel/shared/ui'
import { billingModes, createdWindows, loadStores, storefrontStates, storeStatuses } from '../../api/stores'
import { harnessEnabled } from '../../harness'
import { StoresPending, StoresRouteError, StoresScreen } from '../../features/stores/StoresScreen'
import { isPreLive } from '../../api/me'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6). Loose, so the
// harness keys survive a filter change; `?billing=own` asks the fixture for own-billing mode (§11.4).
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
  loaderDeps: ({ search: { status, plan, created, storefront, near, q, billing } }) => ({ status, plan, created, storefront, near, q, billing: typeof billing === 'string' ? billing : undefined }),
  // The first page; "Show 25 more" appends the next in place (§16). Only a Live partner has a list (§1).
  loader: ({ context, deps: { billing, ...filter } }) =>
    !isPreLive(context.me.partner.state) ? loadStores(filter, {}, context.me.role, (harnessEnabled && parseScreenState(billing, billingModes)) || 'dripfunnel') : Promise.resolve(null),
  pendingComponent: StoresPending,
  errorComponent: StoresRouteError,
  component: StoresScreen,
})
