import type postgres from 'postgres'
import { parseHostname } from '#core/hostname'
import { isUuid } from '#core/ids'
import { withSystemScope } from '#db/scoped/index'
import { selectEdgeHost, selectRedirects, type EdgeHostRow } from '#db/scoped/storefrontEdge'

// The edge Worker's question on a cache miss (storefront LIVE-SHOP.md §5 step 1): which store a host is, its live build
// and how it is served. The answer is cached per data centre for at most 60 seconds, so it carries nothing private.

/** How the host is served (SAAS §4.2): past due keeps selling; suspended gets the degraded page; offline gets nothing. */
export type EdgeState = 'open' | 'suspended' | 'offline'

export type LiveHost =
  | { kind: 'none' }
  | { kind: 'store'; storeId: string; partnerId: string; buildId: string | null; state: EdgeState; name: string; language: string; indexNowKey: string; primaryHost: string | null }

const stateOf = (row: EdgeHostRow): EdgeState => {
  switch (row.status) {
    case 'trial':
    case 'active':
    case 'past_due':
      return 'open'
    case 'suspended':
      return 'suspended'
    case 'cancelled':
      return row.selling_out ? 'open' : 'offline'
    case 'closed':
      return 'offline'
  }
}

export const lookupLiveHost = async (sql: postgres.Sql, rawHost: string, options: { localhost: boolean }): Promise<LiveHost> => {
  const parsed = parseHostname(rawHost, { localhost: options.localhost })
  if (!parsed.ok || parsed.wildcard) return { kind: 'none' }
  const row = await withSystemScope(sql, (tx) => selectEdgeHost(tx, parsed.host))
  if (!row) return { kind: 'none' }
  return { kind: 'store', storeId: row.store_id, partnerId: row.partner_id, buildId: row.live_build_id, state: stateOf(row), name: row.name, language: row.main_language, indexNowKey: row.indexnow_key, primaryHost: row.primary_host }
}

/** The newest renamed addresses the edge holds per store; an older one answers the build's fallback (decided on #484). */
export const maxEdgeRedirects = 5_000

/**
 * The renamed addresses of the store its hostname named, as one list (LIVE-SHOP §5 step 6): the edge Worker caches it per
 * data centre for at most 60 seconds and answers every path from it, so no shopper's path is a database read.
 */
export const lookupRedirects = async (sql: postgres.Sql, storeId: string): Promise<{ redirects: { from: string; to: string; everyLanguage: boolean }[] }> => {
  if (!isUuid(storeId)) return { redirects: [] }
  const rows = await withSystemScope(sql, (tx) => selectRedirects(tx, storeId, maxEdgeRedirects))
  // A null language is every language (DATA-MODEL §7.8): the edge also answers it under another language's prefix.
  return { redirects: rows.map((r) => ({ from: r.from_path, to: r.to_path, everyLanguage: r.language === null })) }
}

/** The tags the edge Worker stores each lookup under, and the ones `cache.purge` names (LIVE-SHOP §5 step 1). */
export const edgeCacheTags = {
  store: (storeId: string) => `df-store-${storeId}`,
  host: (host: string) => `df-host-${host.toLowerCase()}`,
  partner: (partnerId: string) => `df-partner-${partnerId}`,
}
