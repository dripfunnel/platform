import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { loadCustomer } from '../../api/customers'
import { callerFor } from '../../features/common/harnessCaller'
import { activityTabSearch } from '../../features/common/activitySearch'
import { optionalParam } from '@dripfunnel/shared/search'
import { CustomerLoading } from '../../features/customers/CustomerDetail'
import { CustomerDetailScreen, CustomerRouteError } from '../../features/customers/CustomerDetailScreen'
import { customerTabs } from '../../features/customers/CustomerTabs'

export const Route = createFileRoute('/_app/customers_/$customerId')({
  validateSearch: z.object({ tab: optionalParam(z.enum(customerTabs)), ...activityTabSearch }),
  loader: ({ params, location, context }) => loadCustomer(params.customerId, callerFor(context.me.role, location.searchStr)),
  pendingComponent: CustomerLoading,
  errorComponent: CustomerRouteError,
  component: CustomerDetailScreen,
})
