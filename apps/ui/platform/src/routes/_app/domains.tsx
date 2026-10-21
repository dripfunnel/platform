import { createFileRoute } from '@tanstack/react-router'
import { loadDomains } from '../../api/domains'
import { DomainsLoading } from '../../features/domains/Domains'
import { DomainsRouteError, DomainsScreen } from '../../features/domains/DomainsScreen'

// Addresses are set up before Live (the checklist's items 3 to 5), so the page loads in every state.
export const Route = createFileRoute('/_app/domains')({
  loader: () => loadDomains(),
  pendingComponent: DomainsLoading,
  errorComponent: DomainsRouteError,
  component: DomainsScreen,
})
