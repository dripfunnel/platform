import { partnerStates, setupFilters, type PartnerFilter } from '../../api/partners'
import { messages } from '../../messages'
import { FilterSelect, SearchField } from '@dripfunnel/shared/ui'
import { isFiltered } from './isFiltered'

const words = messages.partners
const stateOptions = partnerStates.map((state) => ({ value: state, label: words.states[state] }))
const setupOptions = setupFilters.map((setup) => ({ value: setup, label: words.filters[setup] }))

export interface PartnerFiltersProps {
  filter: PartnerFilter
  onChange: (filter: PartnerFilter) => void
}

export const PartnerFilters = ({ filter, onChange }: PartnerFiltersProps) => (
  <form role="search" aria-label={words.filters.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
    <SearchField
      label={words.filters.search}
      placeholder={words.filters.searchPlaceholder}
      value={filter.q}
      onChange={(q) => onChange({ ...filter, q })}
    />
    <FilterSelect
      label={words.filters.state}
      anyLabel={words.filters.anyState}
      options={stateOptions}
      value={filter.status}
      onChange={(status) => onChange({ ...filter, status })}
    />
    <FilterSelect
      label={words.filters.setup}
      anyLabel={words.filters.anySetup}
      options={setupOptions}
      value={filter.setup}
      onChange={(setup) => onChange({ ...filter, setup })}
    />
    {isFiltered(filter) && (
      <button type="button" className="df-link-button" onClick={() => onChange({})}>
        {words.filters.clear}
      </button>
    )}
  </form>
)
