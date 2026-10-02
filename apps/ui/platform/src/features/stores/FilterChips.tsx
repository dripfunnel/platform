import { Link } from '@tanstack/react-router'
import type { StoreFilter } from '../../api/stores'
import { fill, messages } from '../../messages'
import { filterKeys, withoutFilter, type FilterKey } from './storeSearch'

const words = messages.stores.filters

const chipLabel = (filter: StoreFilter, key: FilterKey, plans: readonly { id: string; name: string }[]): string | null => {
  const value = filter[key]
  if (value === undefined) return null
  switch (key) {
    case 'status':
      return `${words.status}: ${messages.stores.statuses[value as NonNullable<StoreFilter['status']>]}`
    case 'plan':
      return `${words.plan}: ${plans.find((plan) => plan.id === value)?.name ?? value}`
    case 'created':
      return `${words.created}: ${words[value as NonNullable<StoreFilter['created']>]}`
    case 'storefront':
      return `${words.storefront}: ${messages.stores.storefronts[value as NonNullable<StoreFilter['storefront']>]}`
    case 'near':
      return `${words.near}: ${words.yes}`
    case 'q':
      return `${words.search}: ${value}`
  }
}

// Every applied filter as a removable chip, each a link to the URL without it (FIRST-RELEASE.md §6.1).
export const FilterChips = ({ filter, plans }: { filter: StoreFilter; plans: readonly { id: string; name: string }[] }) => {
  const chips = filterKeys.flatMap((key) => {
    const label = chipLabel(filter, key, plans)
    return label === null ? [] : [{ key, label }]
  })
  if (chips.length === 0) return null
  return (
    <div className="df-chips" role="group" aria-label={words.chipsLabel}>
      {chips.map((chip) => (
        <Link key={chip.key} to="/stores" search={(prev) => withoutFilter(prev, chip.key)} replace className="df-chip" aria-label={fill(words.remove, { filter: chip.label })}>
          {chip.label}
          <span aria-hidden="true">×</span>
        </Link>
      ))}
      <Link to="/stores" search={(prev) => withoutFilter(prev)} replace className="df-chips-clear">
        {words.clearAll}
      </Link>
    </div>
  )
}
