import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope } from '#db/scoped/index'
import { countWishlist, deleteWishlistItem, insertWishlistItem, maxWishlist, selectProductSeen, selectWishlistProductIds } from '#db/scoped/wishlist'
import type { ShopProductView } from '#engine/modules/storefront/index'

export { maxWishlist } from '#db/scoped/wishlist'

// A signed-in shopper's wishlist (#1213; FIRST-RELEASE §19 `wishlist`): per product, at most 100, kept for its own account
// in its own store. Every change is an account event (LOGGING §3).

export const wishlistAudit = { added: 'customer.wishlist_added', removed: 'customer.wishlist_removed' } as const

export type WishlistRefusal = 'SIGNED_OUT' | 'NOT_FOUND' | 'LIMIT'
export type WishlistResult<T> = { ok: true; value: T } | { ok: false; reason: WishlistRefusal }

export interface WishlistDeps {
  sql: postgres.Sql
  context: TenantContext
  activity: ActivityLog
  facts: RequestFacts
  /** These products as the shop shows them here, in this order; the ones a shopper can't see or buy here left out. */
  productsByIds: (ids: readonly string[]) => Promise<ShopProductView[]>
  now: () => Date
}

export const createWishlist = ({ sql, context, activity, facts, productsByIds, now }: WishlistDeps) => {
  const { storeId } = context
  const customerId = context.caller.kind === 'shopper' ? context.caller.customerId : null

  const entry = (action: string, me: string, productId: string): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'customer',
    actorId: me,
    actorLabel: null,
    partnerId: context.partnerId,
    storeId,
    customerId: me,
    target: { type: 'product', id: productId, label: 'Wishlist' },
    reason: null,
    api: 'shop',
    visibility: 'store',
    ...facts,
  })

  const signedIn = <T>(work: (me: string) => Promise<WishlistResult<T>>): Promise<WishlistResult<T>> => (customerId ? work(customerId) : Promise.resolve({ ok: false, reason: 'SIGNED_OUT' }))

  /** The shopper's products, newest first; what is hidden or can't be bought here isn't shown. */
  const list = (): Promise<WishlistResult<ShopProductView[]>> =>
    signedIn(async (me) => {
      const ids = await withScope(sql, context, (tx) => selectWishlistProductIds(tx, storeId, me))
      return { ok: true, value: await productsByIds(ids) }
    })

  /** Adding what is already there changes nothing; the 101st is LIMIT. */
  const add = (productId: string): Promise<WishlistResult<true>> =>
    signedIn(async (me) => {
      if (!isUuid(productId)) return { ok: false, reason: 'NOT_FOUND' }
      const id = productId.toLowerCase()
      return withScope(sql, context, async (tx): Promise<WishlistResult<true>> => {
        if (!(await selectProductSeen(tx, storeId, id))) return { ok: false, reason: 'NOT_FOUND' }
        // One add at a time per shopper, so two at once can't both pass the cap.
        await serialise(tx, `wishlist_item:${me}`)
        if ((await countWishlist(tx, storeId, me)) >= maxWishlist && !(await selectWishlistProductIds(tx, storeId, me)).includes(id)) return { ok: false, reason: 'LIMIT' }
        if (await insertWishlistItem(tx, storeId, me, id, now())) await activity.recordAll(tx, [entry(wishlistAudit.added, me, id)])
        return { ok: true, value: true }
      })
    })

  /** Removing what isn't there changes nothing. */
  const remove = (productId: string): Promise<WishlistResult<true>> =>
    signedIn(async (me) => {
      if (!isUuid(productId)) return { ok: true, value: true }
      const id = productId.toLowerCase()
      return withScope(sql, context, async (tx): Promise<WishlistResult<true>> => {
        if (await deleteWishlistItem(tx, storeId, me, id)) await activity.recordAll(tx, [entry(wishlistAudit.removed, me, id)])
        return { ok: true, value: true }
      })
    })

  return { list, add, remove }
}
