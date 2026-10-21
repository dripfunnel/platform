import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { CustomersPage } from '../../features/customers/CustomersPage'

export const Route = createFileRoute('/_app/customers')({ validateSearch: z.object({ customer: z.string().optional() }), component: CustomersPage })
