import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadMe } from '../../api/me'
import { jobStates, loadProvisioningJobs } from '../../api/provisioning'
import { paces } from '../../api/provisioningSample'
import { provisioningSteps } from '../../api/provisioningSteps'
import { callerFor } from '../../features/common/harnessCaller'
import { idParam, optionalParam, searchParam } from '@dripfunnel/shared/ui'
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
  pace: optionalParam(z.enum(paces)),
})

export const Route = createFileRoute('/_app/provisioning')({
  validateSearch: provisioningSearch,
  // The sample's pace only times the next run, so changing it doesn't reload the page.
  loaderDeps: ({ search: { partner, status, step, q, after, before } }) => ({ partner, status, step, q, after, before }),
  loader: async ({ deps: { after, before, ...filter }, location }) => {
    const me = await loadMe()
    return loadProvisioningJobs(filter, { after, before }, callerFor(me.role, location.searchStr))
  },
  pendingComponent: ProvisioningLoading,
  errorComponent: ProvisioningRouteError,
  component: ProvisioningScreen,
})
