import type postgres from 'postgres'
import { parseHostname } from '#core/hostname'
import { isUuid } from '#core/ids'
import { withSystemScope } from '#db/scoped/index'
import { selectEdgeHost, selectRedirect, type EdgeHostRow } from '#db/scoped/storefrontEdge'

// The edge Worker's question on a cache miss (storefront LIVE-SHOP.md §5 step 1): which store a host is, its live build
// and how it is served. The answer is cached per data centre for at most 60 seconds, so it carries nothing private.

/** How the host is served (SAAS §4.2): past due keeps selling; suspended gets the degraded page; offline gets nothing. */
export type EdgeState = 'open' | 'suspended' | 'offline'

export type LiveHost =
  | { kind: 'none' }
  | { kind: 'store'; storeId: string; partnerId: string; buildId: string | null; state: EdgeState; name: string; language: string; indexNowKey: string }

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
  return { kind: 'store', storeId: row.store_id, partnerId: row.partner_id, buildId: row.live_build_id, state: stateOf(row), name: row.name, language: row.main_language, indexNowKey: row.indexnow_key }
}

const redirectPath = /^(\/[A-Za-z0-9._~@+,=-]+)+$/

/**
 * A path the live build has no file for, asked by the edge Worker for the store its hostname named (LIVE-SHOP §5 step 6):
 * the renamed address's 301 target, or null. The answer is cached per data centre for at most 60 seconds.
 */
export const lookupRedirect = async (sql: postgres.Sql, storeId: string, path: string): Promise<{ to: string | null }> => {
  if (!isUuid(storeId) || path.length > 2048 || !redirectPath.test(path)) return { to: null }
  return { to: await withSystemScope(sql, (tx) => selectRedirect(tx, storeId, path)) }
}

/** The tags the edge Worker stores each lookup under, and the ones `cache.purge` names (LIVE-SHOP §5 step 1). */
export const edgeCacheTags = {
  store: (storeId: string) => `df-store-${storeId}`,
  host: (host: string) => `df-host-${host.toLowerCase()}`,
  partner: (partnerId: string) => `df-partner-${partnerId}`,
}
