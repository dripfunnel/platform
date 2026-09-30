import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { idParam } from '../../features/common/searchParams'
import { customerFilterSearch } from '../../features/customers/customerSearch'
import { CustomersScreen } from '../../features/customers/CustomersScreen'

export const Route = createFileRoute('/_app/customers')({
  validateSearch: z.object({ partner: idParam, store: idParam, ...customerFilterSearch }),
  component: CustomersScreen,
})
