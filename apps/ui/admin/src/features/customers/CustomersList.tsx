import { useRef, useState } from 'react'
import type { CustomerFilter, CustomerPage } from '../../api/customers'
import type { PageRequest } from '@dripfunnel/shared/graphql'
import type { PagerProps } from '../common/Pager'
import type { CustomersState } from './customerHarness'
import { CustomersView } from './CustomersView'
import { useCustomerPage } from './useCustomerPage'

export interface CustomersListProps {
  filter: CustomerFilter
  page: PageRequest
  // Set on a store's Customers tab: the list is that store's, and says so by leaving it out.
  store?: string
  forced: CustomersState | null
  empty: { title: string; body: string }
  onFilterChange: (filter: CustomerFilter) => void
  pageLink: PagerProps['link']
}

// The Customers list, on its own screen and on each store's page (§5.4). The search term is
// held here and never reaches the URL (decided on #42), so while it is set the pages are
// stepped here too; the filters and their pages stay in the URL, so a filtered view can be
// shared.
export const CustomersList = ({ filter, page, store, forced, empty, onFilterChange, pageLink }: CustomersListProps) => {
  const [search, setSearch] = useState<string | undefined>(undefined)
  const [searchPage, setSearchPage] = useState<PageRequest>({})
  const { result, reload } = useCustomerPage(store ? { ...filter, store } : filter, search ? searchPage : page, search ?? null)
  // Kept from the last answer, so the Partner and Store choices don't vanish while a page loads.
  const options = useRef<Pick<CustomerPage, 'partners' | 'stores'>>({ partners: [], stores: [] })
  if (result.kind === 'ready') options.current = result.page

  const changeFilter = (next: CustomerFilter) => {
    setSearchPage({})
    onFilterChange(next)
  }
  const changeSearch = (next: string | undefined) => {
    setSearchPage({})
    setSearch(next)
  }

  return (
    <CustomersView
      result={result}
      filter={filter}
      search={search}
      options={options.current}
      inStore={store !== undefined}
      forced={forced}
      empty={empty}
      onFilterChange={changeFilter}
      onSearch={changeSearch}
      onClear={() => {
        changeSearch(undefined)
        changeFilter({})
      }}
      onRetry={reload}
      pageLink={search ? (cursor, label) => <SearchPageButton label={label} onClick={() => setSearchPage(cursor)} /> : pageLink}
    />
  )
}

const SearchPageButton = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="df-button" onClick={onClick}>
    {label}
  </button>
)
