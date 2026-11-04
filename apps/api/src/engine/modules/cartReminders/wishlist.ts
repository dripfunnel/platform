import type postgres from 'postgres'
import type { Money } from '#core/money'
import type { TenantContext } from '#core/tenancy'
import { defaultFeatures, type FeatureKey } from '#db/scoped/catalogListing'
import { createStorefrontCatalog } from '#engine/modules/storefront/index'

/** Most the reminder email lists (#1213). */
export const reminderWishlistItems = 4

/** What a wishlist item is, for a cart's page and its reminder: the product and its price from. */
export interface WishlistItemNow {
  productId: string
  name: string
  slug: string
  /** The cheapest version's price in the cart's currency; null when none is priced there. */
  price: Money | null
}

/**
 * Of an account's wishlist products (newest first), those the shopper could buy now, as the cart's market and currency
 * show them: visible, sold there and in stock. `limit` cuts the list after that check, so a sold-out item never takes a slot.
 */
export const wishlistItemsNow = async (
  deps: { sql: postgres.Sql; now: () => Date },
  cart: { storeId: string; partnerId: string; language: string; currency: string; marketId: string | null; features: Partial<Record<FeatureKey, boolean>> },
  productIds: readonly string[],
  limit: number | null,
): Promise<WishlistItemNow[]> => {
  if (productIds.length === 0) return []
  const context: TenantContext = { caller: { kind: 'shopper', customerId: null, orderTokenHash: null }, partnerId: cart.partnerId, storeId: cart.storeId, sellerScope: { kind: 'all' }, subscription: 'active' }
  const products = await createStorefrontCatalog({ sql: deps.sql, context, language: cart.language, currency: cart.currency, marketId: cart.marketId, features: { ...defaultFeatures, ...cart.features }, now: deps.now }).productsByIds(productIds)
  return products
    .filter((p) => p.inStock)
    .slice(0, limit ?? undefined)
    .map((p) => ({ productId: p.id, name: p.name, slug: p.slug, price: p.price }))
}
