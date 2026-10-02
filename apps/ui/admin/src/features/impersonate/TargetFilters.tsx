import { membershipRoles, targetKinds, targetStatuses, type TargetFilter, type TargetPage } from '../../api/impersonation'
import { messages } from '../../messages'
import { FilterSelect, SearchField } from '@dripfunnel/shared/ui'

const words = messages.impersonate
const typeOptions = targetKinds.map((kind) => ({ value: kind, label: words.kinds[kind] }))
const roleOptions = membershipRoles.map((role) => ({ value: role, label: words.roles[role] }))
const statusOptions = targetStatuses.map((status) => ({ value: status, label: words.statuses[status] }))

export interface TargetFiltersProps {
  filter: TargetFilter
  search: string | undefined
  options: Pick<TargetPage, 'partners' | 'stores'>
  onChange: (filter: TargetFilter) => void
  onSearch: (search: string | undefined) => void
  onClear: () => void
}

// A chosen partner narrows the Store choices to its own stores.
export const TargetFilters = ({ filter, search, options, onChange, onSearch, onClear }: TargetFiltersProps) => {
  const stores = filter.partner ? options.stores.filter((store) => store.partnerId === filter.partner) : options.stores
  const filtered = search !== undefined || Object.values(filter).some((value) => value !== undefined)
  return (
    <form role="search" aria-label={words.filters.label} className="df-list-filters" onSubmit={(event) => event.preventDefault()}>
      <SearchField label={words.users.searchLabel} placeholder={words.users.searchPlaceholder} value={search} onChange={onSearch} />
      <FilterSelect label={words.filters.type} anyLabel={words.filters.anyType} options={typeOptions} value={filter.type} onChange={(type) => onChange({ ...filter, type })} />
      <FilterSelect
        label={words.filters.partner}
        anyLabel={words.filters.anyPartner}
        options={options.partners.map((partner) => ({ value: partner.id, label: partner.name }))}
        value={filter.partner}
        onChange={(partner) => onChange({ ...filter, partner, store: undefined })}
      />
      <FilterSelect
        label={words.filters.store}
        anyLabel={words.filters.anyStore}
        options={stores.map((store) => ({ value: store.id, label: store.name }))}
        value={filter.store}
        onChange={(store) => onChange({ ...filter, store })}
      />
      <FilterSelect label={words.filters.role} anyLabel={words.filters.anyRole} options={roleOptions} value={filter.role} onChange={(role) => onChange({ ...filter, role })} />
      <FilterSelect
        label={words.filters.status}
        anyLabel={words.filters.anyStatus}
        options={statusOptions}
        value={filter.status}
        onChange={(status) => onChange({ ...filter, status })}
      />
      {filtered && (
        <button type="button" className="df-button" onClick={onClear}>
          {words.filters.clear}
        </button>
      )}
    </form>
  )
}
