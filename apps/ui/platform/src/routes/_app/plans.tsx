import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadPlans } from '../../api/plans'
import { PlansLoading } from '../../features/plans/Plans'
import { PlansRouteError, PlansScreen } from '../../features/plans/PlansScreen'

// Plans exist before the partner is Live (the checklist prices them), so the catalogue loads in every state.
export const Route = createFileRoute('/_app/plans')({
  validateSearch: z.looseObject({ state: z.string().optional(), partner: z.string().optional() }),
  loader: () => loadPlans(),
  pendingComponent: PlansLoading,
  errorComponent: PlansRouteError,
  component: PlansScreen,
})
