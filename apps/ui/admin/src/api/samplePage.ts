import type { PageInfo, PageRequest } from '@dripfunnel/shared/graphql'

// How every sample server pages a sorted list by cursor, as the Admin API will: a record's id
// is its cursor, `before` steps back a page and `after` steps forward.
export const samplePage = <Item extends { id: string }>(all: readonly Item[], page: PageRequest, size: number) => {
  const afterIndex = page.after ? all.findIndex((item) => item.id === page.after) : -1
  const beforeIndex = page.before ? all.findIndex((item) => item.id === page.before) : -1
  const start = beforeIndex >= 0 ? Math.max(0, beforeIndex - size) : afterIndex + 1
  const end = beforeIndex >= 0 ? beforeIndex : start + size
  const items = all.slice(start, end)
  const pageInfo: PageInfo = {
    startCursor: items[0]?.id ?? null,
    endCursor: items.at(-1)?.id ?? null,
    hasPreviousPage: start > 0,
    hasNextPage: end < all.length,
  }
  return { items, pageInfo }
}
