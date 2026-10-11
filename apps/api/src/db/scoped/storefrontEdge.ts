import type { ScopedSql } from './index'
import { storefrontHostMatch } from './shopCaller'

// What the edge Worker asks about a storefront host (storefront LIVE-SHOP.md §5 step 1), read in system scope before any
// tenant exists, as the Shop API's own host lookup is (shopCaller.ts).

export interface EdgeHostRow {
  store_id: string
  partner_id: string
  name: string
  main_language: string
  status: 'trial' | 'active' | 'past_due' | 'suspended' | 'cancelled' | 'closed'
  selling_out: boolean
  live_build_id: string | null
}

export const selectEdgeHost = async (tx: ScopedSql, host: string): Promise<EdgeHostRow | null> => {
  const rows = await tx<EdgeHostRow[]>`
    select s.id as store_id, s.partner_id, s.name, s.main_language, s.status, f.live_build_id,
      (s.status = 'cancelled' and exists (select 1 from store_subscription x where x.store_id = s.id and x.cancel_at > now())) as selling_out
    from store s join storefront f on f.store_id = s.id
    where ${storefrontHostMatch(tx, host)}
    limit 2`
  // Two stores claiming one host is a data fault: neither is served, as in the Shop API.
  return rows.length === 1 ? (rows[0] ?? null) : null
}

/** Where a store's old address now lives (storefront ARCHITECTURE §8), read in system scope for the edge Worker. */
export const selectRedirect = async (tx: ScopedSql, storeId: string, path: string): Promise<string | null> =>
  (await tx<{ to_path: string }[]>`select to_path from storefront_redirect where store_id = ${storeId} and from_path = ${path}`)[0]?.to_path ?? null
