import { nextPage, previousPage } from './paging'

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
