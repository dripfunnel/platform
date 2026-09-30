import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadCustomer } from '../../api/customers'
import { loadMe } from '../../api/me'
import { callerFor } from '../../features/common/harnessCaller'
import { optionalParam } from '../../features/common/searchParams'
import { CustomerLoading } from '../../features/customers/CustomerDetail'
import { CustomerDetailScreen, CustomerRouteError } from '../../features/customers/CustomerDetailScreen'
import { customerTabs } from '../../features/customers/CustomerTabs'

export const Route = createFileRoute('/_app/customers_/$customerId')({
  validateSearch: z.object({ tab: optionalParam(z.enum(customerTabs)) }),
  loader: async ({ params, location }) => {
    const me = await loadMe()
    return loadCustomer(params.customerId, callerFor(me.role, location.searchStr))
  },
  pendingComponent: CustomerLoading,
  errorComponent: CustomerRouteError,
  component: CustomerDetailScreen,
})
