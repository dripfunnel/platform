import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { idParam, optionalParam } from '../../features/common/searchParams'
import { Stores } from '../../features/stores/Stores'

const storesSearch = z.object({
  partner: idParam,
  status: optionalParam(z.enum(['trial', 'active', 'pastdue', 'suspended', 'cancelled'])),
  created: optionalParam(z.enum(['7d'])),
  setup: optionalParam(z.enum(['done', 'failed', 'stuck'])),
})

export const Route = createFileRoute('/_app/stores')({ validateSearch: storesSearch, component: Stores })
