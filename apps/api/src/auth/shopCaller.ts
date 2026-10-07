import type postgres from 'postgres'
import type { TenantContext } from '#core/tenancy'
import { withSystemScope } from '#db/scoped/index'
import { hashSessionId } from './session'
import { resolveShopperSession } from './shopperAuth'
import { defaultFeatures, featureKeys, type FeatureKey } from '#db/scoped/catalogListing'
import { selectStorefrontByHost, selectStorefrontByKey, type StorefrontRow } from '#db/scoped/shopCaller'

// A Shop API request's store (ACCESS §3, PLATFORM-PROMPT §5.5): from the storefront's host or its public store key,
// never a secret or an argument; and what it reads in: a language, currency and market the store offers.

export const shopKeyHeader = 'x-shop-key'
export const shopLanguageHeader = 'x-shop-language'
export const shopCurrencyHeader = 'x-shop-currency'
export const shopMarketHeader = 'x-shop-market'
/** A guest's cart token (SAPI 9), handed out by `addToCart` and sent back with every cart call. */
export const shopCartHeader = 'x-shop-cart'
/** A signed-in shopper's session token (SAPI 9), handed out by sign-in. */
export const shopSessionHeader = 'x-shop-session'

export interface Shopper {
  context: TenantContext
  /** What the store's storefronts may show: past due keeps selling (FIRST-RELEASE §1); suspended and closed don't. */
  available: boolean
  catalogVersion: string
  mainLanguage: string
  /** The store's country: which payment providers and couriers it may use. */
  country: string | null
  /** A preview storefront: checkout takes payment in each provider's test mode. */
  preview: boolean
  pricingCurrency: string
  language: string
  currency: string
  marketId: string | null
  /** Which product page sections the store shows (CATALOG P1). */
  features: Readonly<Record<FeatureKey, boolean>>
}

export type ShopResolution = { kind: 'found'; shopper: Shopper } | { kind: 'unknown' } | { kind: 'key-mismatch' }

const shopperOf = (row: StorefrontRow, request: Request, orderTokenHash: string | null, customerId: string | null): Shopper | null => {
  if (!row.pricing_currency) return null
  const market = row.markets.find((m) => m.id === request.headers.get(shopMarketHeader)?.trim().toLowerCase()) ?? null
  const asked = (header: string) => request.headers.get(header)?.trim() ?? ''
  const languages = [row.main_language, ...row.languages]
  const currencies = [row.pricing_currency, ...row.currencies]
  // Something the store doesn't offer falls back to its main language and pricing currency, as an unknown market does.
  const language = [asked(shopLanguageHeader), market?.language ?? ''].find((l) => languages.includes(l)) ?? row.main_language
  const currencyAsked = asked(shopCurrencyHeader).toUpperCase()
  const currency = [currencyAsked, market?.currency ?? ''].find((c) => currencies.includes(c)) ?? row.pricing_currency
  return {
    context: { caller: { kind: 'shopper', customerId, orderTokenHash }, partnerId: row.partner_id, storeId: row.store_id, sellerScope: { kind: 'all' }, subscription: row.status === 'closed' ? 'cancelled' : row.status },
    available: row.status === 'trial' || row.status === 'active' || row.status === 'past_due',
    catalogVersion: row.catalog_version,
    mainLanguage: row.main_language,
    country: row.country,
    preview: row.preview,
    pricingCurrency: row.pricing_currency,
    language,
    currency,
    marketId: market?.id ?? null,
    features: Object.fromEntries(featureKeys.map((k) => [k, row.features[k] ?? defaultFeatures[k]])) as Record<FeatureKey, boolean>,
  }
}

/**
 * The host decides when it is a storefront's own; a key sent with it must be that store's, so store X is never served
 * on store Y's host. Anywhere else the key alone decides (a merchant's own frontend, PLATFORM-PROMPT §5.6).
 */
export const resolveShopper = async (sql: postgres.Sql, request: Request, host: string): Promise<ShopResolution> => {
  const key = request.headers.get(shopKeyHeader)?.trim() ?? ''
  const validKey = /^pk_[0-9a-f]{32}$/.test(key)
  const { byHost, byKey } = await withSystemScope(sql, async (tx) => ({
    byHost: await selectStorefrontByHost(tx, host),
    byKey: validKey ? await selectStorefrontByKey(tx, key) : null,
  }))
  if (byHost && key !== '' && byKey?.store_id !== byHost.store_id) return { kind: 'key-mismatch' }
  const row = byHost ?? byKey
  const cartToken = request.headers.get(shopCartHeader)?.trim() ?? ''
  // Only the shape a token is handed out in is hashed; anything else holds no cart.
  const orderTokenHash = /^[0-9a-f]{64}$/.test(cartToken) ? await hashSessionId(cartToken) : null
  // A session names a shopper of this store only; any other is ignored, as if signed out.
  const session = request.headers.get(shopSessionHeader)?.trim() ?? ''
  const customerId = row && session !== '' ? await resolveShopperSession(sql, row.store_id, session, new Date()) : null
  const shopper = row ? shopperOf(row, request, orderTokenHash, customerId) : null
  return shopper ? { kind: 'found', shopper } : { kind: 'unknown' }
}
