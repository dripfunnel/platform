import { createFileRoute } from '@tanstack/react-router'
import { BillingLoading } from '../../features/billing/Billing'
import { BillingRouteError, BillingScreen } from '../../features/billing/BillingScreen'
import { loadBillingFor } from '../../features/billing/loadBilling'

// Who bills and the partner's state come with the shell (§11.4); the money is the API's (#201).
export const Route = createFileRoute('/_app/billing')({
  loader: ({ context }) => loadBillingFor(context.me.role),
  pendingComponent: BillingLoading,
  errorComponent: BillingRouteError,
  component: BillingScreen,
})
