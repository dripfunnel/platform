import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useScreenState } from '../common/useScreenState'
import { customerStates } from './customerHarness'
import { CustomerDetail, CustomerError } from './CustomerDetail'

const customerRoute = getRouteApi('/_app/customers_/$customerId')
const shellRoute = getRouteApi('/_app')

export const CustomerDetailScreen = () => {
  const customer = customerRoute.useLoaderData()
  const { tab = 'overview' } = customerRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(customerStates)
  const router = useRouter()
  return (
    <CustomerDetail
      customer={customer}
      tab={tab}
      forced={forced}
      readOnly={me.role === 'staff-read-only' || forced === 'readonly'}
      onReload={() => void router.invalidate()}
    />
  )
}

// The route's error view: it never shows the thrown error, whose message can carry internals.
export const CustomerRouteError = () => {
  const router = useRouter()
  return <CustomerError onRetry={() => void router.invalidate()} />
}
