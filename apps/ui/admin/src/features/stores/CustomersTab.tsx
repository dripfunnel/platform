import { Link } from '@tanstack/react-router'
import type { CustomerFilter } from '../../api/customers'
import type { PageRequest } from '../../api/pageInfo'
import type { Store } from '../../api/stores'
import { messages } from '../../messages'
import { CustomersList } from '../customers/CustomersList'

export interface StoreCustomers {
  filter: CustomerFilter
  page: PageRequest
  onFilterChange: (filter: CustomerFilter) => void
}

// The Customers list, pre-filtered to this store (§5.4), with its filters in the store's URL.
export const CustomersTab = ({ store, customers }: { store: Store; customers: StoreCustomers }) => (
  <CustomersList
    filter={customers.filter}
    page={customers.page}
    store={store.id}
    forced={null}
    empty={messages.customers.storeEmpty}
    onFilterChange={customers.onFilterChange}
    pageLink={(cursor, label) => (
      <Link to="/stores/$storeId" params={{ storeId: store.id }} search={{ tab: 'customers', ...customers.filter, ...cursor }} className="df-button">
        {label}
      </Link>
    )}
  />
)
