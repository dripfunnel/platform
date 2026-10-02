import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadMe } from '../../api/me'
import { loadPartners, partnerStates, setupFilters } from '../../api/partners'
import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/ui'
import { callerFor } from '../../features/common/harnessCaller'
import { PartnersLoading } from '../../features/partners/Partners'
import { PartnersRouteError, PartnersScreen } from '../../features/partners/PartnersScreen'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6).
const partnersSearch = z.object({
  status: optionalParam(z.enum(partnerStates)),
  setup: optionalParam(z.enum(setupFilters)),
  q: searchParam,
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
