import { getRouteApi, Link } from '@tanstack/react-router'
import { useCallback } from 'react'
import type { CustomerFilter } from '../../api/customers'
import { useScreenState } from '@dripfunnel/shared/ui'
import { harnessEnabled } from '../../harness'
import { customersStates } from './customerHarness'
import { Customers } from './Customers'

const customersRoute = getRouteApi('/_app/customers')
const shellRoute = getRouteApi('/_app')

export const CustomersScreen = () => {
  const { after, before, ...filter } = customersRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(customersStates, harnessEnabled)
  const navigate = customersRoute.useNavigate()
  // A new filter starts from the first page, so the cursors are dropped with the old one.
  const onFilterChange = useCallback((next: CustomerFilter) => void navigate({ search: next, replace: true }), [navigate])
  return (
    <Customers
      filter={filter}
      page={{ after, before }}
      forced={forced}
      readOnly={me.role === 'staff-read-only' || forced === 'readonly'}
      onFilterChange={onFilterChange}
      pageLink={(cursor, label) => (
        <Link to="/customers" search={{ ...filter, ...cursor }} className="df-button">
          {label}
        </Link>
      )}
    />
  )
}
