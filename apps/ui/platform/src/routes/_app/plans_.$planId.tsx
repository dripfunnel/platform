import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadPlanEditor } from '../../api/plans'
import { PlanEditorLoading } from '../../features/plans/PlanEditor'
import { PlanEditorRouteError, PlanEditorScreen } from '../../features/plans/PlanEditorScreen'

// `new` is the empty editor; any other id is a plan of the catalogue (FIRST-RELEASE.md §7.2).
export const Route = createFileRoute('/_app/plans_/$planId')({
  validateSearch: z.looseObject({ state: z.string().optional(), partner: z.string().optional() }),
  loader: ({ params, context }) => loadPlanEditor(params.planId === 'new' ? null : params.planId, context.me.role),
  pendingComponent: PlanEditorLoading,
  errorComponent: PlanEditorRouteError,
  component: PlanEditorScreen,
})
