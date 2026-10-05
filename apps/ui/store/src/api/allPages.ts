/** One page of a list as the API answers it: its rows, whether there are more, and where they start. */
export interface PageOf<T> {
  nodes: T[]
  pageInfo: { hasNextPage: boolean; endCursor: string | null }
}

/**
 * Every row of a list a screen needs whole (the store switcher, a picker), fifty a page. A page that promises
 * more but gives no cursor, or one already seen, would truncate or loop for ever; it fails rather than either.
 */
export const allPages = async <T>(read: (after: string | null) => Promise<PageOf<T>>): Promise<T[]> => {
  const all: T[] = []
  const seen = new Set<string>()
  let after: string | null = null
  for (;;) {
    const page: PageOf<T> = await read(after)
    all.push(...page.nodes)
    if (!page.pageInfo.hasNextPage) return all
    const next = page.pageInfo.endCursor
    if (!next || seen.has(next)) throw new Error('paging made no progress')
    seen.add(next)
    after = next
  }
}
