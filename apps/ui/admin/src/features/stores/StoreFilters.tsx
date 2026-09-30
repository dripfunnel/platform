import { createdWindows, storefrontStates, storeStatuses, type StoreFilter } from '../../api/stores'
import { messages } from '../../messages'
import { FilterSelect } from '../common/FilterSelect'
import { SearchField } from '../common/SearchField'
import { isFiltered } from './isFiltered'

const words = messages.stores
const statusOptions = storeStatuses.map((status) => ({ value: status, label: words.statuses[status] }))
const storefrontOptions = storefrontStates.map((storefront) => ({ value: storefront, label: words.storefronts[storefront] }))
const createdOptions = createdWindows.map((created) => ({ value: created, label: words.filters[created] }))

export interface StoreFiltersProps {
  filter: StoreFilter
  partners: readonly { id: string; name: string }[]
  onChange: (filter: StoreFilter) => void
}

// The prototype's four filters. `setup` has no control: it arrives only from the Dashboard's
// links (decided on #20) and goes with Clear filters.
export const StoreFilters = ({ filter, partners, onChange }: StoreFiltersProps) => (
  <form role="search" aria-label={words.filters.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
    <SearchField
      label={words.filters.search}
      placeholder={words.filters.searchPlaceholder}
      value={filter.q}
      onChange={(q) => onChange({ ...filter, q })}
    />
    <FilterSelect
      label={words.filters.partner}
      anyLabel={words.filters.anyPartner}
      options={partners.map((partner) => ({ value: partner.id, label: partner.name }))}
      value={filter.partner}
      onChange={(partner) => onChange({ ...filter, partner })}
    />
    <FilterSelect
      label={words.filters.status}
      anyLabel={words.filters.anyStatus}
      options={statusOptions}
      value={filter.status}
      onChange={(status) => onChange({ ...filter, status })}
    />
    <FilterSelect
      label={words.filters.storefront}
      anyLabel={words.filters.anyStorefront}
      options={storefrontOptions}
      value={filter.storefront}
      onChange={(storefront) => onChange({ ...filter, storefront })}
    />
    <FilterSelect
      label={words.filters.created}
      anyLabel={words.filters.anyTime}
      options={createdOptions}
      value={filter.created}
      onChange={(created) => onChange({ ...filter, created })}
    />
    {isFiltered(filter) && (
      <button type="button" className="df-link-button" onClick={() => onChange({})}>
        {words.filters.clear}
      </button>
    )}
  </form>
)
