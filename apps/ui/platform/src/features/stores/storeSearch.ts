import type { StoreFilter } from '../../api/stores'

export const filterKeys = ['status', 'plan', 'created', 'storefront', 'near', 'q'] as const satisfies readonly (keyof StoreFilter)[]
export type FilterKey = (typeof filterKeys)[number]

// The filter is the part of the URL the list owns; the harness keys (`state`, `partner`) and the
// Dashboard's `store` and `tab` stay when it changes.
export const filterOf = (search: Record<string, unknown>): StoreFilter =>
  Object.fromEntries(filterKeys.filter((key) => search[key] !== undefined).map((key) => [key, search[key]])) as StoreFilter

export const withoutFilter = (search: Record<string, unknown>, only?: FilterKey): Record<string, unknown> => {
  const dropped: readonly string[] = only ? [only] : filterKeys
  return Object.fromEntries(Object.entries(search).filter(([key]) => !dropped.includes(key)))
}

export const isFiltered = (filter: StoreFilter) => filterKeys.some((key) => filter[key] !== undefined)
