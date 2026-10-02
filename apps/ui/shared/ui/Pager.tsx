import type { ReactNode } from 'react'
import type { PageInfo } from '../graphql/pageInfo'
import './list.css'

export interface PagerWords {
  previous: string
  next: string
}

export interface PagerProps {
  label: string
  words: PagerWords
  pageInfo: PageInfo
  // The list's own link to the page on either side, so the cursors land in its URL.
  link: (cursor: { before: string } | { after: string }, label: string) => ReactNode
}

const Disabled = ({ label }: { label: string }) => (
  <button type="button" className="df-button" disabled>
    {label}
  </button>
)

// Cursor paging, Previous and Next only, across the consoles (decided on #19): no page
// numbers and no total, because the APIs page by cursor.
export const Pager = ({ label, words, pageInfo, link }: PagerProps) => {
  if (!pageInfo.hasPreviousPage && !pageInfo.hasNextPage) return null
  return (
    <nav className="df-pager" aria-label={label}>
      {pageInfo.hasPreviousPage && pageInfo.startCursor ? link({ before: pageInfo.startCursor }, words.previous) : <Disabled label={words.previous} />}
      {pageInfo.hasNextPage && pageInfo.endCursor ? link({ after: pageInfo.endCursor }, words.next) : <Disabled label={words.next} />}
    </nav>
  )
}
