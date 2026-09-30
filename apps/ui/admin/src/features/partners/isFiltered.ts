import type { PartnerFilter } from '../../api/partners'

// One answer to "is a filter applied?", for the Clear button and the no-match state alike.
export const isFiltered = (filter: PartnerFilter) => filter.q !== undefined || filter.status !== undefined || filter.setup !== undefined
