import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { cursorParam } from '../../features/rollouts/rolloutSearch'
import { loadRollouts } from '../../api/rollouts'
import { RolloutsLoading } from '../../features/rollouts/Rollouts'
import { RolloutsRouteError, RolloutsScreen } from '../../features/rollouts/RolloutsScreen'
import { rolloutsCaller } from '../../features/rollouts/rolloutsHarness'

export const Route = createFileRoute('/_app/rollouts')({
  validateSearch: z.object({ after: cursorParam }),
  loaderDeps: ({ search: { after } }) => ({ after }),
  loader: ({ deps, location, context }) => loadRollouts(deps, rolloutsCaller(context.me.role, location.searchStr)),
  pendingComponent: RolloutsLoading,
  errorComponent: RolloutsRouteError,
  component: RolloutsScreen,
})
