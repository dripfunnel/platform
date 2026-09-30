// A page of a cursor-paged admin list (decided on #19): where it starts and ends, and
// whether there is more on either side.
export interface PageInfo {
  startCursor: string | null
  endCursor: string | null
  hasPreviousPage: boolean
  hasNextPage: boolean
}
