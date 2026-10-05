import type { ScopedSql } from './index'

// A store's or supplier's connection to its Shopify shop (migrations/0060; CATALOG K7). The token is sealed by the
// caller (auth/secretBox) before it reaches here and is never selected for display.

export interface ConnectionRow {
  id: string
  store_id: string
  seller_id: string | null
  shop_domain: string
  status: 'pending' | 'connected' | 'expired'
  token_sealed: string | null
  return_host: string | null
  connected_by: string
  connected_at: Date | null
  expires_at: Date | null
}

/** The owner's one connection, if any; row security keeps a supplier to its own. */
export const selectConnection = async (tx: ScopedSql, storeId: string, sellerId: string | null): Promise<ConnectionRow | null> =>
  (await tx<ConnectionRow[]>`select * from external_connection where store_id = ${storeId} and seller_id is not distinct from ${sellerId} and provider = 'shopify'`)[0] ?? null

/** Starting again replaces whatever was there, a connected shop included, until the new one is approved. */
export const savePendingConnection = async (tx: ScopedSql, c: { storeId: string; sellerId: string | null; shop: string; stateHash: string; returnHost: string; by: string; expiresAt: Date }): Promise<void> => {
  await tx`delete from external_connection where store_id = ${c.storeId} and seller_id is not distinct from ${c.sellerId} and provider = 'shopify'`
  await tx`
    insert into external_connection (store_id, seller_id, provider, shop_domain, status, state_hash, return_host, connected_by, expires_at)
    values (${c.storeId}, ${c.sellerId}, 'shopify', ${c.shop}, 'pending', ${c.stateHash}, ${c.returnHost}, ${c.by}, ${c.expiresAt})
  `
}

export const deleteConnection = async (tx: ScopedSql, storeId: string, sellerId: string | null): Promise<boolean> =>
  (await tx`delete from external_connection where store_id = ${storeId} and seller_id is not distinct from ${sellerId} and provider = 'shopify' returning id`).length === 1

export const markConnectionExpired = async (tx: ScopedSql, id: string): Promise<void> => {
  await tx`update external_connection set status = 'expired', token_sealed = null where id = ${id} and status = 'connected'`
}

/** The callback's pending row, by the hash of the state Shopify sent back (system scope: the hooks host has no session). */
export const selectPendingByState = async (tx: ScopedSql, stateHash: string): Promise<(ConnectionRow & { partner_id: string }) | null> =>
  (await tx<(ConnectionRow & { partner_id: string })[]>`
    select c.*, s.partner_id from external_connection c join store s on s.id = c.store_id where c.state_hash = ${stateHash} and c.status = 'pending'
  `)[0] ?? null

export const completeConnection = async (tx: ScopedSql, id: string, tokenSealed: string, at: Date): Promise<boolean> =>
  (
    await tx`
      update external_connection set status = 'connected', token_sealed = ${tokenSealed}, state_hash = null, connected_at = ${at}, expires_at = null
      where id = ${id} and status = 'pending' returning id
    `
  ).length === 1

/** Approvals never finished, after their ten minutes. */
export const deleteStalePendingConnections = async (tx: ScopedSql, now: Date): Promise<number> =>
  (await tx`delete from external_connection where status = 'pending' and expires_at < ${now} returning id`).length

/** A connection unused for a day goes, token and all (THIRD-PARTY-ACCESS §3.4), unless an import is still reading it. */
export const deleteAbandonedConnections = async (tx: ScopedSql, now: Date): Promise<number> =>
  (
    await tx`
      delete from external_connection c where c.status in ('connected', 'expired') and coalesce(c.connected_at, c.created_at) < ${new Date(now.getTime() - 24 * 60 * 60 * 1000)}
        and not exists (select 1 from catalog_import i where i.connection_id = c.id and i.state = 'checking')
      returning c.id
    `
  ).length
