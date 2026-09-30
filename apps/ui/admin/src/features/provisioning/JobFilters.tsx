import { jobStates, type JobFilter } from '../../api/provisioning'
import { provisioningSteps } from '../../api/provisioningSteps'
import { messages } from '../../messages'
import { FilterSelect } from '../common/FilterSelect'
import { SearchField } from '../common/SearchField'

const words = messages.provisioning
const stateOptions = jobStates.map((state) => ({ value: state, label: words.states[state] }))
// A job still in the list hasn't reached Done, so Done is no step to filter by.
const stepOptions = provisioningSteps.filter((step) => step !== 'done').map((step) => ({ value: step, label: words.steps[step] }))

export interface JobFiltersProps {
  filter: JobFilter
  partners: readonly { id: string; name: string }[]
  onChange: (filter: JobFilter) => void
}

// The prototype's three filters and its search, all in the URL.
export const JobFilters = ({ filter, partners, onChange }: JobFiltersProps) => (
  <form role="search" aria-label={words.filters.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
    <SearchField label={words.filters.search} placeholder={words.filters.searchPlaceholder} value={filter.q} onChange={(q) => onChange({ ...filter, q })} />
    <FilterSelect
      label={words.filters.partner}
      anyLabel={words.filters.anyPartner}
      options={partners.map((partner) => ({ value: partner.id, label: partner.name }))}
      value={filter.partner}
      onChange={(partner) => onChange({ ...filter, partner })}
    />
    <FilterSelect label={words.filters.state} anyLabel={words.filters.anyState} options={stateOptions} value={filter.status} onChange={(status) => onChange({ ...filter, status })} />
    <FilterSelect label={words.filters.step} anyLabel={words.filters.anyStep} options={stepOptions} value={filter.step} onChange={(step) => onChange({ ...filter, step })} />
    {Object.values(filter).some((value) => value !== undefined) && (
      <button type="button" className="df-link-button" onClick={() => onChange({})}>
        {words.filters.clear}
      </button>
    )}
  </form>
)
