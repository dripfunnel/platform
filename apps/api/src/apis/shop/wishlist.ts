import { GraphQLError } from 'graphql'
import { createWishlist, wishlistAudit, type WishlistResult } from '#engine/modules/wishlist/index'
import { shopOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'
import { catalogOf } from './catalog'
import type { registerProducts } from './products'

// A signed-in shopper's wishlist (FIRST-RELEASE §19 `wishlist`; #1213): its own account's, in this store. A guest has none.

const words: Record<string, string> = {
  SIGNED_OUT: 'Sign in first.',
  NOT_FOUND: 'That product isn’t here.',
  LIMIT: 'Your wishlist is full. Remove something first.',
}

const answered = <T>(result: WishlistResult<T>): T => {
  if (result.ok) return result.value
  throw new GraphQLError(words[result.reason] ?? '', { extensions: { code: result.reason } })
}

const wishlistOf = (ctx: ShopContext) => {
  const { sql, shopper } = shopOf(ctx)
  const catalog = catalogOf(ctx)
  return createWishlist({ sql, context: shopper.context, activity: ctx.activity, facts: ctx.facts, productsByIds: catalog.productsByIds, now: ctx.now })
}

export const registerWishlist = ({ builder }: ShopBuilder, Summary: ReturnType<typeof registerProducts>['Summary']) => {
  const access = { api: 'shop', scope: 'shop', permission: null } as const

  builder.queryFields((t) => ({
    // Newest first, at most 100; a product that is hidden or can't be bought here is left out.
    wishlist: t.field({ type: [Summary], extensions: { access }, resolve: async (_, __, ctx) => answered(await wishlistOf(ctx).list()) }),
  }))

  builder.mutationFields((t) => ({
    // Adding what is there already changes nothing; the 101st is LIMIT.
    addToWishlist: t.boolean({
      args: { productId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: wishlistAudit.added } },
      resolve: async (_, args, ctx) => answered(await wishlistOf(ctx).add(String(args.productId))),
    }),
    removeFromWishlist: t.boolean({
      args: { productId: t.arg.id({ required: true }) },
      extensions: { access: { ...access, audit: wishlistAudit.removed } },
      resolve: async (_, args, ctx) => answered(await wishlistOf(ctx).remove(String(args.productId))),
    }),
  }))
}
