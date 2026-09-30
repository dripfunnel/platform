import { Link } from '@tanstack/react-router'
import type { PageInfo, PartnerFilter } from '../../api/partners'
import { messages } from '../../messages'
import './partners.css'

const words = messages.partners.pager

// Cursor paging, Previous and Next only, across the console (decided on #19). The cursors
// are the API's and go in the URL with the filters, so a pasted link opens the same page.
export const Pager = ({ pageInfo, filter }: { pageInfo: PageInfo; filter: PartnerFilter }) => {
  if (!pageInfo.hasPreviousPage && !pageInfo.hasNextPage) return null
  return (
    <nav className="df-pager" aria-label={words.label}>
      {pageInfo.hasPreviousPage && pageInfo.startCursor ? (
        <Link to="/partners" search={{ ...filter, before: pageInfo.startCursor }} className="df-button">
          {words.previous}
        </Link>
      ) : (
        <button type="button" className="df-button" disabled>
          {words.previous}
        </button>
      )}
      {pageInfo.hasNextPage && pageInfo.endCursor ? (
        <Link to="/partners" search={{ ...filter, after: pageInfo.endCursor }} className="df-button">
          {words.next}
        </Link>
      ) : (
        <button type="button" className="df-button" disabled>
          {words.next}
        </button>
      )}
    </nav>
  )
}
