import { GraphQLError } from 'graphql'
import { hashSessionId } from '#auth/session'
import type { CartView } from '#engine/modules/cart/index'
import { restoreCart, unsubscribe, type LinkResult } from '#engine/modules/cartReminders/index'
import { limitCodeTries, shopOf, type ShopContext } from './access'
import type { ShopBuilder } from './builder'
import { cartOf, type registerCart } from './cart'

// A cart reminder's two links (FIRST-RELEASE §19 Shop API): `cart/r/{token}` and `unsubscribe/{token}` on the storefront call
// these. Each lookup is limited per host and address, and every token that can't be used gets the same answer.

const invalid = () => new GraphQLError('This link doesn’t work any more.', { extensions: { code: 'LINK_INVALID' } })

const answered = <T>(result: LinkResult<T>): T => {
  if (result.ok) return result.value
  throw invalid()
}

/** Per storefront host and address, on the codes' limiter: a token can't be guessed by trying (FIRST-RELEASE §19). */
const limited = (ctx: ShopContext) => limitCodeTries(ctx, 'cart-link', 'Too many tries. Wait a minute and try again.')

interface RestoredView {
  cart: CartView | null
  token: string | null
  signInRequired: boolean
}

export const registerReminderLinks = ({ builder }: ShopBuilder, Cart: ReturnType<typeof registerCart>['Cart']) => {
  const Restored = builder.objectRef<RestoredView>('ShopRestoredCart').implement({
    fields: (t) => ({
      // Null when the cart is an account's and this shopper isn't signed in to it.
      cart: t.field({ type: Cart, nullable: true, resolve: (r) => r.cart }),
      // The guest cart's new token, given once: send it back as X-Shop-Cart.
      cartToken: t.exposeString('token', { nullable: true }),
      // The cart is an account's: sign in, and it is the account's cart.
      signInRequired: t.exposeBoolean('signInRequired'),
    }),
  })
  const deps = (ctx: ShopContext) => {
    const { sql, shopper } = shopOf(ctx)
    return { sql, context: shopper.context, activity: ctx.activity, facts: ctx.facts, now: ctx.now }
  }

  builder.mutationFields((t) => ({
    restoreCart: t.field({
      type: Restored,
      args: { token: t.arg.string({ required: true }) },
      // A shopper's cart, which LOGGING §3 leaves out.
      extensions: { access: { api: 'shop', scope: 'shop', permission: null, unlogged: 'cart' } },
      resolve: async (_, args, ctx) => {
        await limited(ctx)
        if (args.token.length > 100) throw invalid()
        const restored = answered(await restoreCart(deps(ctx), args.token))
        if (restored.signInRequired) return { cart: null, token: null, signInRequired: true }
        const { shopper } = shopOf(ctx)
        // The cart is read as the browser will hold it from now on: by the token just handed out, or the shopper's account.
        const caller = shopper.context.caller.kind === 'shopper' ? shopper.context.caller : { kind: 'shopper' as const, customerId: null }
        const held = restored.token ? { ...shopper, context: { ...shopper.context, caller: { ...caller, orderTokenHash: await hashSessionId(restored.token) } } } : shopper
        return { cart: await (await cartOf({ ...ctx, shopper: held })).cart(), token: restored.token, signInRequired: false }
      },
    }),
    unsubscribe: t.boolean({
      args: { token: t.arg.string({ required: true }) },
      extensions: { access: { api: 'shop', scope: 'shop', permission: null, audit: 'customer.consent_recorded' } },
      resolve: async (_, args, ctx) => {
        await limited(ctx)
        if (args.token.length > 100) throw invalid()
        return answered(await unsubscribe(deps(ctx), args.token))
      },
    }),
  }))
}
