import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadPartners, partnerStates, setupFilters } from '../../api/partners'
import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/search'
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
  loader: ({ deps: { after, before, ...filter } }) => loadPartners(filter, { after, before }),
  pendingComponent: PartnersLoading,
  errorComponent: PartnersRouteError,
  component: PartnersScreen,
})
