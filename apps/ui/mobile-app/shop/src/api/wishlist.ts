import { z } from 'zod'
import { decode, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { cardOf, summaryFields, summarySchema, type ProductCard } from './catalogue'
import { operation, type Operation } from './operation'

// The signed-in shopper's wishlist on the Shop API (apps/api schema/shop.graphql, #1213). It is personal, so it is never kept for offline.

/** Newest first, at most 100; a product that is hidden or can't be bought here is left out by the API. */
export const wishlistOperation = (): Operation<ProductCard[]> =>
  operation(null, `{ wishlist { ${summaryFields} } }`, {}, (data) => (decode(z.object({ wishlist: z.array(summarySchema).nullable() }), data).wishlist ?? []).map(cardOf))

/** Just the ids, for a product page's heart. */
export const wishlistIdsOperation = (): Operation<string[]> =>
  operation(null, '{ wishlist { id } }', {}, (data) => (decode(z.object({ wishlist: z.array(z.object({ id: z.string() })).nullable() }), data).wishlist ?? []).map((p) => p.id))

/** Adding what is there already changes nothing; the 101st is refused as LIMIT. */
export const addToWishlist = async (client: ApiClient, productId: string): Promise<void> => {
  await client.request<unknown>('mutation($productId: ID!) { addToWishlist(productId: $productId) }', { productId })
}

export const removeFromWishlist = async (client: ApiClient, productId: string): Promise<void> => {
  await client.request<unknown>('mutation($productId: ID!) { removeFromWishlist(productId: $productId) }', { productId })
}
