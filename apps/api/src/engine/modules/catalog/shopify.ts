import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import type { TenantContext } from '#core/tenancy'
import { appendImportFile, failImport, insertShopifyImport, saveImportCheck, selectCatalogImport } from '#db/scoped/catalogImports'
import { deleteConnection, finishConnection, markConnectionExpired, savePendingConnection, selectConnection, type ConnectionRow } from '#db/scoped/externalConnections'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { catalogImportAudit, catalogImportKind, catalogImportLifetimeMs, type CatalogImportDeps } from './imports'
import { jobPayloadOf } from './jobScope'
import { shopifyHeader, shopifyRows, type ShopProduct } from './shopifyFile'
import { csvLine } from '#core/csv'

// Connect Shopify (CATALOG K7): the owner's shop address, approval on Shopify, back to pick products, then the
// import's own check and run. The engine names what it needs of Shopify; integrations/shopify provides it.

export const shopifyAudit = { connectStarted: 'shopify.connect_started', connected: 'shopify.connected', disconnected: 'shopify.disconnected' } as const
const pendingMs = 10 * 60 * 1000
const pageSize = 25
export const maxPicked = 250

/** Shopify refused the token: the app was uninstalled or its access revoked. */
export class ShopUnauthorized extends Error {}
/** Shopify didn't answer, or answered in a way we don't read. */
export class ShopUnavailable extends Error {}

export interface ShopGateway {
  authorizeUrl: (shop: string, state: string, redirectUri: string) => string
  products: (shop: string, token: string, page: { after: string | null; first: number; search?: string | null; ids?: readonly string[] | null }) => Promise<{ products: ShopProduct[]; next: string | null }>
}

export interface ShopConnect {
  gateway: ShopGateway
  /** The callback Shopify returns to, on the hooks host (hooks/shopify.ts). */
  redirectUri: string
}

/** A shop's own address only, `*.myshopify.com`, so what's typed never names a host of the user's choosing. */
export const shopDomainOf = (input: string): string | null => {
  const text = input.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '')
  const shop = text.includes('.') ? text : `${text}.myshopify.com`
  return /^[a-z0-9][a-z0-9-]{0,60}\.myshopify\.com$/.test(shop) ? shop : null
}

export const hashState = async (state: string): Promise<string> =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(state)))].map((b) => b.toString(16).padStart(2, '0')).join('')

export type ShopifyRefusal = 'NOT_AVAILABLE' | 'INVALID_SHOP' | 'NOT_CONNECTED' | 'EXPIRED' | 'SHOPIFY_UNAVAILABLE' | 'INVALID_INPUT'
export type ShopifyResult<T> = { ok: true; value: T } | { ok: false; reason: ShopifyRefusal }

export interface ShopifyConnectionDto {
  /** False where no Shopify app is set up: the screen offers the CSV route only. */
  available: boolean
  status: 'none' | 'pending' | 'connected' | 'expired'
  shop: string | null
}

export interface ShopifyDeps extends CatalogImportDeps {
  shop: ShopConnect | null
  secrets: SecretBox | null
  /** The portal host the person is on, to come back to after Shopify. */
  host: string
}

const gid = z.string().regex(/^gid:\/\/shopify\/Product\/\d{1,20}$/)

export const createShopifyService = (d: ShopifyDeps) => {
  const { sql, context, actor, activity, facts, now, shop, secrets, queue } = d
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const inScope = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, context, work)
  const entry = (action: string, target: { type: string; id: string; label: string }): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    sellerId,
    target,
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const connection = (): Promise<ShopifyConnectionDto> =>
    inScope(async (tx) => {
      const row = await selectConnection(tx, storeId, sellerId)
      const waiting = (row?.status === 'pending' || row?.status === 'approved') && (row.expires_at === null || row.expires_at > now())
      const status = !row || ((row.status === 'pending' || row.status === 'approved') && !waiting) ? 'none' : row.status === 'approved' ? 'pending' : row.status
      return { available: shop !== null && secrets !== null, status, shop: row?.shop_domain ?? null }
    })

  /** Where to send the person to approve the app; the state comes back to the hooks host, hashed here. */
  const connect = async (input: string): Promise<ShopifyResult<string>> => {
    if (!shop || !secrets) return { ok: false, reason: 'NOT_AVAILABLE' }
    const domain = shopDomainOf(input)
    if (!domain) return { ok: false, reason: 'INVALID_SHOP' }
    const state = [...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')
    const stateHash = await hashState(state)
    await inScope(async (tx) => {
      await savePendingConnection(tx, { storeId, sellerId, shop: domain, stateHash, returnHost: d.host, by: actor.id, expiresAt: new Date(now().getTime() + pendingMs) })
      await activity.record(tx, entry(shopifyAudit.connectStarted, { type: 'connection', id: domain, label: domain }))
    })
    return { ok: true, value: shop.gateway.authorizeUrl(domain, state, shop.redirectUri) }
  }

  /** Back from Shopify with the key the callback gave: only the person who started it finishes it (login CSRF). */
  const finish = async (key: string): Promise<ShopifyResult<string>> => {
    if (!/^[0-9a-f]{64}$/.test(key)) return { ok: false, reason: 'NOT_CONNECTED' }
    const finishHash = await hashState(key)
    return inScope(async (tx) => {
      const done = await finishConnection(tx, { storeId, sellerId, finishHash, by: actor.id, at: now() })
      if (!done) return { ok: false, reason: 'NOT_CONNECTED' }
      await activity.record(tx, entry(shopifyAudit.connected, { type: 'connection', id: done.id, label: done.shop_domain }))
      return { ok: true, value: done.shop_domain }
    })
  }

  const disconnect = (): Promise<ShopifyResult<true>> =>
    inScope(async (tx) => {
      const row = await selectConnection(tx, storeId, sellerId)
      if (!row || !(await deleteConnection(tx, storeId, sellerId))) return { ok: false, reason: 'NOT_CONNECTED' }
      await activity.record(tx, entry(shopifyAudit.disconnected, { type: 'connection', id: row.id, label: row.shop_domain }))
      return { ok: true, value: true }
    })

  const connected = async (): Promise<{ row: ConnectionRow; token: string } | ShopifyRefusal> => {
    if (!shop || !secrets) return 'NOT_AVAILABLE'
    const row = await inScope((tx) => selectConnection(tx, storeId, sellerId))
    if (row?.status === 'expired') return 'EXPIRED'
    if (row?.status !== 'connected' || !row.token_sealed) return 'NOT_CONNECTED'
    const token = await secrets.open(row.token_sealed)
    return token ? { row, token } : 'EXPIRED'
  }

  /** A page of the shop's products for the picker (K7), newest first. */
  const products = async (after: string | null, search: string | null): Promise<ShopifyResult<{ products: ShopProduct[]; next: string | null }>> => {
    const c = await connected()
    if (typeof c === 'string' || !shop) return { ok: false, reason: typeof c === 'string' ? c : 'NOT_AVAILABLE' }
    try {
      return { ok: true, value: await shop.gateway.products(c.row.shop_domain, c.token, { after, first: pageSize, search }) }
    } catch (error) {
      if (error instanceof ShopUnauthorized) {
        await inScope((tx) => markConnectionExpired(tx, c.row.id))
        return { ok: false, reason: 'EXPIRED' }
      }
      if (error instanceof ShopUnavailable) return { ok: false, reason: 'SHOPIFY_UNAVAILABLE' }
      throw error
    }
  }

  /** The picked products, or every one (null), read into an import that is then checked as a file would be. */
  const startImport = async (ids: readonly string[] | null): Promise<ShopifyResult<string>> => {
    if (ids !== null && (ids.length === 0 || ids.length > maxPicked || !ids.every((id) => gid.safeParse(id).success))) return { ok: false, reason: 'INVALID_INPUT' }
    const c = await connected()
    if (typeof c === 'string') return { ok: false, reason: c }
    const id = await inScope(async (tx) => {
      const made = await insertShopifyImport(tx, { storeId, sellerId, connectionId: c.row.id, selection: ids === null ? null : [...new Set(ids)], byId: actor.id, byLabel: actor.label })
      const payload = jobPayloadOf(context, made)
      if (payload) await queue(tx, catalogImportKind, `${made}:fetch:start`, { ...payload, phase: 'fetch' })
      await activity.record(tx, entry(catalogImportAudit.started, { type: 'import', id: made, label: c.row.shop_domain }))
      return made
    })
    return { ok: true, value: id }
  }

  return { connection, connect, finish, disconnect, products, startImport }
}

export type ShopifyService = ReturnType<typeof createShopifyService>

export interface ShopFetchDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
  shop: ShopConnect | null
  secrets: SecretBox | null
  queue: CatalogImportDeps['queue']
}

const pickBatch = 50

/**
 * One page of a connected import's products into its file (K7), then the next page, then the check. An expired
 * connection ends the import saying so; Shopify not answering throws, so the relay tries again later.
 */
export const fetchShopPage = async (d: ShopFetchDeps, jobId: string): Promise<void> => {
  const { storeId } = d.context
  const sellerId = d.context.sellerScope.kind === 'seller' ? d.context.sellerScope.sellerId : null
  const ended = async (tx: ScopedSql, code: 'SHOPIFY_EXPIRED' | 'NOT_AVAILABLE') => {
    const at = d.now()
    await saveImportCheck(tx, jobId, { source: 'shopify', plan: null, products: 0, ready: 0, matched: 0, problems: [{ line: 0, column: null, code }] })
    await failImport(tx, jobId, at, new Date(at.getTime() + catalogImportLifetimeMs))
  }
  const read = await withScope(d.sql, d.context, async (tx) => ({ job: await selectCatalogImport(tx, storeId, jobId), connection: await selectConnection(tx, storeId, sellerId) }))
  const { job, connection } = read
  if (job?.state !== 'checking' || job.file === null) return
  const token = connection?.status === 'connected' && connection.id === job.connection_id && connection.token_sealed && d.secrets ? await d.secrets.open(connection.token_sealed) : null
  if (!d.shop || !connection || !token) return withScope(d.sql, d.context, (tx) => ended(tx, d.shop ? 'SHOPIFY_EXPIRED' : 'NOT_AVAILABLE'))
  const picked = z.array(z.string()).nullable().catch(null).parse(job.selection)
  let page: { products: ShopProduct[]; next: string | null }
  try {
    if (picked) {
      const at = Number(job.cursor ?? 0)
      const got = await d.shop.gateway.products(connection.shop_domain, token, { after: null, first: pickBatch, ids: picked.slice(at, at + pickBatch) })
      page = { products: got.products, next: at + pickBatch < picked.length ? String(at + pickBatch) : null }
    } else page = await d.shop.gateway.products(connection.shop_domain, token, { after: job.cursor, first: pageSize })
  } catch (error) {
    if (!(error instanceof ShopUnauthorized)) throw error
    return withScope(d.sql, d.context, async (tx) => {
      await markConnectionExpired(tx, connection.id)
      await ended(tx, 'SHOPIFY_EXPIRED')
    })
  }
  await withScope(d.sql, d.context, async (tx) => {
    const rows = page.products.flatMap(shopifyRows)
    const text = [...(job.file === '' ? [csvLine(shopifyHeader)] : []), ...rows].map((line) => `${line}\n`).join('')
    await appendImportFile(tx, jobId, text, page.next)
    // Read: the token has done its job and goes (THIRD-PARTY-ACCESS §3.4); another import connects again.
    if (page.next === null && (await deleteConnection(tx, storeId, sellerId))) {
      await d.activity.record(tx, {
        category: 'write',
        action: shopifyAudit.disconnected,
        result: 'success',
        actorKind: 'person',
        actorId: d.actor.id,
        actorLabel: null,
        partnerId: d.actor.partnerId,
        storeId,
        sellerId,
        target: { type: 'connection', id: connection.id, label: connection.shop_domain },
        reason: 'import_read',
        api: 'store',
        visibility: 'store',
        ...d.facts,
      })
    }
    const payload = jobPayloadOf(d.context, jobId)
    if (payload) await d.queue(tx, catalogImportKind, `${jobId}:${page.next === null ? 'check' : `fetch:${page.next}`}`, { ...payload, phase: page.next === null ? 'check' : 'fetch' })
  })
}
