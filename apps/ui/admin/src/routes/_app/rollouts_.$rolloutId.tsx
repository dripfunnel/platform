import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { optionalParam } from '@dripfunnel/shared/search'
import { cursorParam } from '../../features/common/cursorParam'
import { loadRollout, storeUpgradeStates } from '../../api/rollouts'
import { RolloutDetailLoading } from '../../features/rollouts/RolloutDetail'
import { RolloutDetailRouteError, RolloutDetailScreen } from '../../features/rollouts/RolloutDetailScreen'
import { rolloutsCaller } from '../../features/rollouts/rolloutsHarness'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6).
export const Route = createFileRoute('/_app/rollouts_/$rolloutId')({
  validateSearch: z.object({ status: optionalParam(z.enum(storeUpgradeStates)), after: cursorParam, before: cursorParam }),
  loaderDeps: ({ search: { status, after, before } }) => ({ status, after, before }),
  loader: ({ params, deps: { status, after, before }, location, context }) =>
    loadRollout(params.rolloutId, { state: status }, { after, before }, rolloutsCaller(context.me.role, location.searchStr)),
  pendingComponent: RolloutDetailLoading,
  errorComponent: RolloutDetailRouteError,
  component: RolloutDetailScreen,
})
