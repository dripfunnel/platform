import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { categoryOptions, loadStoreCategories } from '../../api/storeCategories'
import { createdWindows, loadStores, setupStates, storefrontStates, storeStatuses } from '../../api/stores'
import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/search'
import { cursorParam } from '../../features/common/cursorParam'
import { StoresLoading } from '../../features/stores/Stores'
import { StoresRouteError, StoresScreen } from '../../features/stores/StoresScreen'
import { unlessPhone } from '../../features/common/usePhone'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6). The
// Dashboard links here with `created`, `setup` and `status` (decided on #20).
const storesSearch = z.object({
  partner: idParam,
  status: optionalParam(z.enum(storeStatuses)),
  storefront: optionalParam(z.enum(storefrontStates)),
  setup: optionalParam(z.enum(setupStates)),
  created: optionalParam(z.enum(createdWindows)),
  category: idParam,
  q: searchParam,
  after: cursorParam,
  before: cursorParam,
})

export const Route = createFileRoute('/_app/stores')({
  validateSearch: storesSearch,
  loaderDeps: ({ search }) => search,
  // A phone shows Find a store instead (phoneView), which runs its own search.
  loader: ({ deps: { after, before, ...filter } }) =>
    unlessPhone(async () => {
      const [page, categories] = await Promise.all([loadStores(filter, { after, before }), loadStoreCategories()])
      return { ...page, categories: categoryOptions(categories) }
    }),
  pendingComponent: StoresLoading,
  errorComponent: StoresRouteError,
  component: StoresScreen,
})
