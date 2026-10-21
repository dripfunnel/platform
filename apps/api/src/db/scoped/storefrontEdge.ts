import type { ScopedSql } from './index'
import { primaryHostOf, storefrontHostMatch } from './shopCaller'

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
  indexnow_key: string
  /** Every other address of the store redirects here (SAAS §8). */
  primary_host: string | null
}

export const selectEdgeHost = async (tx: ScopedSql, host: string, shopDomain: string | null): Promise<EdgeHostRow | null> => {
  const rows = await tx<EdgeHostRow[]>`
    select s.id as store_id, s.partner_id, s.name, s.main_language, s.status, f.live_build_id, f.indexnow_key,
      ${primaryHostOf(tx, shopDomain)} as primary_host,
      (s.status = 'cancelled' and exists (select 1 from store_subscription x where x.store_id = s.id and x.cancel_at > now())) as selling_out
    from store s join storefront f on f.store_id = s.id
    where ${storefrontHostMatch(tx, host, shopDomain)}
    limit 2`
  // Two stores claiming one host is a data fault: neither is served, as in the Shop API.
  return rows.length === 1 ? (rows[0] ?? null) : null
}

/** A store's renamed addresses (storefront ARCHITECTURE §8), newest first, read in system scope for the edge Worker. */
export const selectRedirects = (tx: ScopedSql, storeId: string, limit: number): Promise<{ from_path: string; to_path: string; language: string | null }[]> =>
  tx<{ from_path: string; to_path: string; language: string | null }[]>`select from_path, to_path, language from storefront_redirect where store_id = ${storeId} order by created_at desc, from_path limit ${limit}`
