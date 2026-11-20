import { createFileRoute } from '@tanstack/react-router'
import { loadDomains } from '../../api/domains'
import { DomainsLoading } from '../../features/domains/Domains'
import { DomainsRouteError, DomainsScreen } from '../../features/domains/DomainsScreen'

// Addresses are set up before Live (the checklist's items 3 to 5), so the page loads in every state.
// pendingMs 0: the loading view shows at the click, not after the router's 1 s default (#1589).
export const Route = createFileRoute('/_app/domains')({
  loader: () => loadDomains(),
  pendingMs: 0,
  pendingComponent: DomainsLoading,
  errorComponent: DomainsRouteError,
  component: DomainsScreen,
})
