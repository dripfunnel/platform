// A page of a cursor-paged console list (decided on #19): where it starts and ends, and
// whether there is more on either side.
export interface PageInfo {
  startCursor: string | null
  endCursor: string | null
  hasPreviousPage: boolean
  hasNextPage: boolean
}

// Which page to fetch: after one cursor, before another, or the first page with neither.
export interface PageRequest {
  after?: string | undefined
  before?: string | undefined
}
