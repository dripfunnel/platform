import { createFileRoute } from '@tanstack/react-router'
import { BillingRouteError, BillingScreen } from '../../features/billing/BillingScreen'

// No loader: who bills and the partner's state come with the shell (§11.4); the money waits on #201.
export const Route = createFileRoute('/_app/billing')({
  errorComponent: BillingRouteError,
  component: BillingScreen,
})
