import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadMe } from '../../api/me'
import { loadPartners, partnerStates, setupFilters } from '../../api/partners'
import { idParam, optionalParam } from '../../features/common/searchParams'
import { callerFor } from '../../features/partners/partnerHarness'
import { PartnersLoading } from '../../features/partners/Partners'
import { PartnersRouteError, PartnersScreen } from '../../features/partners/PartnersScreen'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6).
const partnersSearch = z.object({
  status: optionalParam(z.enum(partnerStates)),
  setup: optionalParam(z.enum(setupFilters)),
  q: optionalParam(z.string().trim().min(1).max(100)),
  after: idParam,
  before: idParam,
})

export const Route = createFileRoute('/_app/partners')({
  validateSearch: partnersSearch,
  loaderDeps: ({ search }) => search,
  loader: async ({ deps: { after, before, ...filter }, location }) => {
    const me = await loadMe()
    return loadPartners(filter, { after, before }, callerFor(me.role, location.searchStr))
  },
  pendingComponent: PartnersLoading,
  errorComponent: PartnersRouteError,
  component: PartnersScreen,
})
