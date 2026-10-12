'use client'

import { navigate, useLocation } from '../platform/browser/router'
import { useHead } from '../platform/seo/head'
import { useListing, type Listing } from '../products/listing'

// Search (ARCHITECTURE §2.1 `search`): the words are the address's `q`, with filters, sort and pages beside them.

/** The longest search the address keeps. */
export const maxQueryLength = 200

export type Search = Listing & {
  query: string
  /** Searches for new words, dropping the previous search's filters and page. */
  setQuery: (words: string) => void
}

/** The search the address holds; with no words it asks nothing and its status is `idle`. Search pages aren't indexed. */
export const useSearch = (): Search => {
  const { query } = useLocation()
  const words = (query.get('q') ?? '').trim().slice(0, maxQueryLength)
  const listing = useListing({ search: words || null }, words !== '')
  useHead({ hidden: true })
  return {
    ...listing,
    query: words,
    setQuery: (next) => {
      const q = next.trim().slice(0, maxQueryLength)
      const params = new URLSearchParams(q ? { q } : {})
      if (listing.sort !== 'featured') params.set('sort', listing.sort)
      const search = params.toString()
      navigate(`/search/${search ? `?${search}` : ''}`)
    },
  }
}
