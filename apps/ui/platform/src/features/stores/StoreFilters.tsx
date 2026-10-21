import { FilterSelect, SearchField } from '@dripfunnel/shared/ui'
import { createdWindows, storefrontStates, storeStatuses, type StoreFilter } from '../../api/stores'
import { messages } from '../../messages'

const words = messages.stores.filters

const statusOptions = storeStatuses.map((status) => ({ value: status, label: messages.stores.statuses[status] }))
const storefrontOptions = storefrontStates.map((storefront) => ({ value: storefront, label: messages.stores.storefronts[storefront] }))
const createdOptions = createdWindows.map((created) => ({ value: created, label: words[created] }))
const nearOptions = [{ value: 'yes' as const, label: words.nearYes }]

export interface StoreFiltersProps {
  filter: StoreFilter
  plans: readonly { id: string; name: string }[]
  onChange: (filter: StoreFilter) => void
}

// The prototype's search and five filters (FIRST-RELEASE.md §6.1), in its order.
export const StoreFilters = ({ filter, plans, onChange }: StoreFiltersProps) => (
  <form role="search" aria-label={words.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
    <SearchField label={words.search} placeholder={words.searchPlaceholder} value={filter.q} onChange={(q) => onChange({ ...filter, q })} />
    <FilterSelect label={words.status} anyLabel={words.anyStatus} options={statusOptions} value={filter.status} onChange={(status) => onChange({ ...filter, status })} />
    <FilterSelect
      label={words.plan}
      anyLabel={words.anyPlan}
      options={plans.map((plan) => ({ value: plan.id, label: plan.name }))}
      value={filter.plan}
      onChange={(plan) => onChange({ ...filter, plan })}
    />
    <FilterSelect label={words.created} anyLabel={words.anyTime} options={createdOptions} value={filter.created} onChange={(created) => onChange({ ...filter, created })} />
    <FilterSelect
      label={words.storefront}
      anyLabel={words.anyStorefront}
      options={storefrontOptions}
      value={filter.storefront}
      onChange={(storefront) => onChange({ ...filter, storefront })}
    />
    <FilterSelect label={words.near} anyLabel={words.anyNear} options={nearOptions} value={filter.near} onChange={(near) => onChange({ ...filter, near })} />
  </form>
)
