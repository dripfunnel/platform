import { customerStatuses, customerWindows, signInMethods, type CustomerFilter, type CustomerPage } from '../../api/customers'
import { messages } from '../../messages'
import { FilterSelect, SearchField } from '@dripfunnel/shared/ui'
import './customers.css'

const words = messages.customers
const statusOptions = customerStatuses.map((status) => ({ value: status, label: words.statuses[status] }))
const viaOptions = signInMethods.map((via) => ({ value: via, label: words.signInMethods[via] }))
const windowOptions = customerWindows.map((window) => ({ value: window, label: words.filters[window] }))

export interface CustomerFiltersProps {
  filter: CustomerFilter
  search: string | undefined
  options: Pick<CustomerPage, 'partners' | 'stores'>
  // On a store's page the store is the page itself, so neither it nor its partner is a choice.
  inStore: boolean
  onChange: (filter: CustomerFilter) => void
  onSearch: (search: string | undefined) => void
  onClear: () => void
}

export const CustomerFilters = ({ filter, search, options, inStore, onChange, onSearch, onClear }: CustomerFiltersProps) => (
  <form role="search" aria-label={words.filters.label} className="df-list-filters df-customers-filters" onSubmit={(event) => event.preventDefault()}>
    <SearchField label={words.filters.search} placeholder={words.filters.searchPlaceholder} value={search} onChange={onSearch} />
    {!inStore && (
      <>
        <FilterSelect
          label={words.filters.partner}
          anyLabel={words.filters.anyPartner}
          options={options.partners.map((partner) => ({ value: partner.id, label: partner.name }))}
          value={filter.partner}
          onChange={(partner) => onChange({ ...filter, partner })}
        />
        <FilterSelect
          label={words.filters.store}
          anyLabel={words.filters.anyStore}
          options={options.stores.map((store) => ({ value: store.id, label: store.name }))}
          value={filter.store}
          onChange={(store) => onChange({ ...filter, store })}
        />
      </>
    )}
    <FilterSelect
      label={words.filters.status}
      anyLabel={words.filters.anyStatus}
      options={statusOptions}
      value={filter.status}
      onChange={(status) => onChange({ ...filter, status })}
    />
    <FilterSelect label={words.filters.via} anyLabel={words.filters.anyVia} options={viaOptions} value={filter.via} onChange={(via) => onChange({ ...filter, via })} />
    <FilterSelect
      label={words.filters.created}
      anyLabel={words.filters.anyTime}
      options={windowOptions}
      value={filter.created}
      onChange={(created) => onChange({ ...filter, created })}
    />
    <FilterSelect
      label={words.filters.lastSignIn}
      anyLabel={words.filters.anyTime}
      options={windowOptions}
      value={filter.lastSignIn}
      onChange={(lastSignIn) => onChange({ ...filter, lastSignIn })}
    />
    {(search || Object.values(filter).some((value) => value !== undefined)) && (
      <button type="button" className="df-link-button" onClick={onClear}>
        {words.filters.clear}
      </button>
    )}
  </form>
)
