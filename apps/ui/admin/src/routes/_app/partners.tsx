import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { optionalParam } from '../../features/common/searchParams'
import { Partners } from '../../features/partners/Partners'

// `status`, not `state`: ?state= is the designed-states harness (docs/ui/README.md §6).
const partnersSearch = z.object({
  status: optionalParam(z.enum(['draft', 'awaiting', 'live', 'paused', 'offboarding', 'closed'])),
})

export const Route = createFileRoute('/_app/partners')({ validateSearch: partnersSearch, component: Partners })
