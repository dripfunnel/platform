import { getRouteApi, Link, useRouter, useRouterState } from '@tanstack/react-router'
import { shopperActions } from '../../api/activityActions'
import { ActivityTab } from '../common/ActivityTab'
import { callerFor } from '../common/harnessCaller'
import { useScreenState } from '../common/useScreenState'
import { customerStates } from './customerHarness'
import { CustomerDetail, CustomerError } from './CustomerDetail'

const customerRoute = getRouteApi('/_app/customers_/$customerId')
const shellRoute = getRouteApi('/_app')

export const CustomerDetailScreen = () => {
  const customer = customerRoute.useLoaderData()
  const { tab = 'overview', after, before, ...activityFilter } = customerRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const forced = useScreenState(customerStates)
  const navigate = customerRoute.useNavigate()
  const router = useRouter()
  return (
    <CustomerDetail
      customer={customer}
      tab={tab}
      forced={forced}
      readOnly={me.role === 'staff-read-only' || forced === 'readonly'}
      onReload={() => void router.invalidate()}
      activity={
        customer && (
          <ActivityTab
            scope={{ customer: customer.id }}
            filter={activityFilter}
            page={{ after, before }}
            caller={callerFor(me.role, searchStr)}
            actions={shopperActions}
            onFilterChange={(filter) => void navigate({ search: { tab: 'activity', ...filter }, replace: true })}
            pageLink={(cursor, label) => (
              <Link to="/customers/$customerId" params={{ customerId: customer.id }} search={{ tab: 'activity', ...activityFilter, ...cursor }} className="df-button">
                {label}
              </Link>
            )}
          />
        )
      }
    />
  )
}

// The route's error view: it never shows the thrown error, whose message can carry internals.
export const CustomerRouteError = () => {
  const router = useRouter()
  return <CustomerError onRetry={() => void router.invalidate()} />
}
