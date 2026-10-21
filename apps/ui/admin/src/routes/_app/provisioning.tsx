import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { jobStates, loadProvisioningJobs } from '../../api/provisioning'
import { provisioningSteps } from '../../api/provisioningSteps'
import { callerFor } from '../../features/common/harnessCaller'
import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/search'
import { ProvisioningLoading } from '../../features/provisioning/Provisioning'
import { ProvisioningRouteError, ProvisioningScreen } from '../../features/provisioning/ProvisioningScreen'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6).
const provisioningSearch = z.object({
  partner: idParam,
  status: optionalParam(z.enum(jobStates)),
  step: optionalParam(z.enum(provisioningSteps)),
  q: searchParam,
  after: idParam,
  before: idParam,
})

export const Route = createFileRoute('/_app/provisioning')({
  validateSearch: provisioningSearch,
  loaderDeps: ({ search: { partner, status, step, q, after, before } }) => ({ partner, status, step, q, after, before }),
  loader: ({ deps: { after, before, ...filter }, location, context }) => loadProvisioningJobs(filter, { after, before }, callerFor(context.me.role, location.searchStr)),
  pendingComponent: ProvisioningLoading,
  errorComponent: ProvisioningRouteError,
  component: ProvisioningScreen,
})
