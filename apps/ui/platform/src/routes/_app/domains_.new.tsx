import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { domainKinds, loadPartnerDomains } from '../../api/domains'
import { optionalParam } from '@dripfunnel/shared/search'
import { AddDomainLoading } from '../../features/domains/AddDomain'
import { AddDomainRouteError, AddDomainScreen } from '../../features/domains/AddDomainScreen'

// `k` picks the kind, as the empty Domains page's "Add portal address" does (§9.2).
export const Route = createFileRoute('/_app/domains_/new')({
  validateSearch: z.looseObject({ k: optionalParam(z.enum(domainKinds)) }),
  loader: () => loadPartnerDomains(),
  pendingComponent: AddDomainLoading,
  errorComponent: AddDomainRouteError,
  component: AddDomainScreen,
})
