import { isApiError } from './errors'
import { allPages, maxPages, nextPage, previousPage } from './paging'

const page = { startCursor: 'a', endCursor: 'c', hasPreviousPage: true, hasNextPage: true }

describe('cursor paging helpers', () => {
  it('asks for the page after the last record, and the page before the first', () => {
    expect(nextPage(page)).toEqual({ after: 'c' })
    expect(previousPage(page)).toEqual({ before: 'a' })
  })

  it('has no next or previous page where the list ends', () => {
    expect(nextPage({ ...page, hasNextPage: false })).toBeNull()
    expect(previousPage({ ...page, hasPreviousPage: false })).toBeNull()
    expect(nextPage({ startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: true })).toBeNull()
  })
})

describe('allPages', () => {
  const info = (next: string | null) => ({ startCursor: null, endCursor: next, hasPreviousPage: false, hasNextPage: next !== null })

  it('follows each page’s cursor until the list ends, and joins the pages in order', async () => {
    const asked: Array<string | null> = []
    const pages: Record<string, { nodes: number[]; pageInfo: ReturnType<typeof info> }> = { start: { nodes: [1, 2], pageInfo: info('b') }, b: { nodes: [3], pageInfo: info(null) } }

    expect(await allPages(async (after) => (asked.push(after), pages[after ?? 'start'] as (typeof pages)[string]))).toEqual([1, 2, 3])
    expect(asked).toEqual([null, 'b'])
  })

  it('fails as a BAD_RESPONSE, not with a cut-off list, when the list never ends', async () => {
    let reads = 0
    const endless = allPages(async () => ({ nodes: [reads++], pageInfo: info('again') }))

    const error: unknown = await endless.catch((caught: unknown) => caught)
    expect(isApiError(error, 'BAD_RESPONSE')).toBe(true)
    expect(reads).toBe(maxPages)
  })
})
