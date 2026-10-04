import { optionalParam } from '@dripfunnel/shared/search'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { SupportLoading } from '../../features/support/Support'
import { supportTabs } from '../../features/support/supportHarness'
import { SupportRouteError, SupportScreen } from '../../features/support/SupportScreen'
import { loadSupport } from '../../features/support/loadSupport'

// The search text stays out of the address: it is a person's name or email (§12.1, as §13 decides).
export const Route = createFileRoute('/_app/support')({
  validateSearch: z.looseObject({ tab: optionalParam(z.enum(supportTabs)) }),
  loaderDeps: ({ search: { tab } }) => ({ tab: tab ?? 'users' }),
  loader: ({ context, deps: { tab } }) => loadSupport(context.me.role, tab),
  pendingComponent: SupportLoading,
  errorComponent: SupportRouteError,
  component: SupportScreen,
})
