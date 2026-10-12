'use client'

import { createContext, useContext, useMemo, useSyncExternalStore, type ReactNode } from 'react'
import { studioPagePath } from '../render/studio'

// The address a theme sees (ARCHITECTURE §2.1 `platform/browser`): the page's path and query, never the studio frame's
// session prefix (§3.4, AI-STUDIO §8). Filters, sort and pages live in the query (DESIGN §6).

const navigated = 'df:navigate'
let base: string | null = null

/** Set once by core's runtime in the studio frame, so addresses read and written leave out `/__studio/{session}/`. */
export const setRouterBase = (studioBase: string | null) => {
  base = studioBase
}

const current = (): string => `${base ? studioPagePath(base, location.pathname) : location.pathname}${location.search}`

/** Calls `changed` after every navigate() and back or forward button, until the returned function is called. */
export const watchAddress = (changed: () => void) => {
  addEventListener('popstate', changed)
  addEventListener(navigated, changed)
  return () => {
    removeEventListener('popstate', changed)
    removeEventListener(navigated, changed)
  }
}

const ServerAddress = createContext('/')

/** The address a page was rendered for where there is no browser (a static build), and the one it hydrates with. */
export const AddressProvider = ({ address, children }: { address: string; children: ReactNode }) => <ServerAddress.Provider value={address}>{children}</ServerAddress.Provider>

export type Address = { path: string; query: URLSearchParams }

const parse = (href: string): Address => {
  const at = href.indexOf('?')
  return { path: at === -1 ? href : href.slice(0, at), query: new URLSearchParams(at === -1 ? '' : href.slice(at)) }
}

/** The page's path and query; a new value whenever navigate() or the back button changes them. */
export const useLocation = (): Address => {
  const server = useContext(ServerAddress)
  const href = useSyncExternalStore(watchAddress, current, () => server)
  return useMemo(() => parse(href), [href])
}

/**
 * Goes to a path on this store. The same page with another query (a filter, the sort, a page) changes in place, kept in
 * history; another page loads whole, since each live page is its own file (ARCHITECTURE §4.2), unless `inPlace` says
 * the same page shows it (a product's version address).
 */
export const navigate = (href: string, { replace = false, inPlace = false }: { replace?: boolean; inPlace?: boolean } = {}) => {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return
  const next = parse(href)
  const search = next.query.toString()
  const target = `${base ? `${base}${next.path.slice(1)}` : next.path}${search ? `?${search}` : ''}`
  const page = (pathname: string) => (pathname.endsWith('/') ? pathname : `${pathname}/`)
  if (!inPlace && page(new URL(target, location.origin).pathname) !== page(location.pathname)) return location.assign(target)
  if (replace) history.replaceState(history.state, '', target)
  else history.pushState(null, '', target)
  dispatchEvent(new Event(navigated))
}
