import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { createdWindows, loadStores, setupStates, storefrontStates, storeStatuses } from '../../api/stores'
import { idParam, optionalParam, searchParam } from '../../features/common/searchParams'
import { StoresLoading } from '../../features/stores/Stores'
import { StoresRouteError, StoresScreen } from '../../features/stores/StoresScreen'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6). The
// Dashboard links here with `created`, `setup` and `status` (decided on #20).
const storesSearch = z.object({
  partner: idParam,
  status: optionalParam(z.enum(storeStatuses)),
  storefront: optionalParam(z.enum(storefrontStates)),
  setup: optionalParam(z.enum(setupStates)),
  created: optionalParam(z.enum(createdWindows)),
  q: searchParam,
  after: idParam,
  before: idParam,
})

export const Route = createFileRoute('/_app/stores')({
  validateSearch: storesSearch,
  loaderDeps: ({ search }) => search,
  loader: ({ deps: { after, before, ...filter } }) => loadStores(filter, { after, before }),
  pendingComponent: StoresLoading,
  errorComponent: StoresRouteError,
  component: StoresScreen,
})
