import type { StoreFilter } from '../../api/stores'

// One answer to "is a filter applied?", for the Clear button and the no-match state alike.
export const isFiltered = (filter: StoreFilter) => Object.values(filter).some((value) => value !== undefined)
