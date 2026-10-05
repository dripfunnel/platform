/** One page of a list: its rows, and the cursor of the next page if there is one. */
export interface PageOf<T> {
  nodes: T[]
  next: string | null
}

/**
 * Every row of a list a screen needs whole (the store switcher, a picker), fifty a page. A page that promises
 * more but gives no new cursor would loop for ever; it fails rather than truncates.
 */
export const allPages = async <T>(read: (after: string | null) => Promise<PageOf<T>>): Promise<T[]> => {
  const all: T[] = []
  const seen = new Set<string>()
  let after: string | null = null
  for (;;) {
    const page: PageOf<T> = await read(after)
    all.push(...page.nodes)
    if (page.next === null) return all
    if (seen.has(page.next)) throw new Error('paging made no progress')
    seen.add(page.next)
    after = page.next
  }
}
