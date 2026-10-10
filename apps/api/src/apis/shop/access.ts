import type postgres from 'postgres'
import type { SecretBox } from '#auth/secretBox'
import type { LinkSigner } from '#auth/signedLink'
import type { PaymentMode } from '#core/payments'
import { withSystemScope } from '#db/scoped/index'
import { selectStripeAccountId } from '#db/scoped/payments'
import type { PaymentWiring } from '#engine/modules/checkout/index'
import type { StripeTaxDeps } from '#engine/modules/tax/index'
import { GraphQLError } from 'graphql'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { CodeCheck } from '#auth/codeCheck'
import type { Shopper } from '#auth/shopCaller'
import type { CourierDirectory } from '#core/couriers'
import type { AccessPolicy } from '../graphql/scope'

export interface ShopContext extends Record<string, unknown> {
  /** Null when the Worker has no database: every shop field then answers STORE_UNAVAILABLE. */
  sql: postgres.Sql | null
  /** The storefront's store, found by its host or public key before the request reaches here (auth/shopCaller.ts). */
  shopper: Shopper | null
  /** `https://{host}`, for the addresses of the files a storefront shows. */
  origin: string
  activity: ActivityLog
  facts: RequestFacts
  /** The partners' couriers, for a cart's delivery options (SAPI 23); null where none can be reached. */
  couriers?: CourierDirectory | null
  /** The card adapters and Stripe Tax (SAPI 10); null where none is set up. */
  payments?: PaymentWiring | null
  /** Opens a store's pasted payment keys for a call (THIRD-PARTY-ACCESS §3.1). */
  secrets?: SecretBox | null
  /** The sign-in limiter (SIGN_IN_RATE_LIMITER) by key; refuses everything where it isn't bound. */
  allowAttempt?: (key: string) => Promise<boolean>
  codeCheck?: CodeCheck
  /** The session token this request presents (X-Shop-Session), for signing out. */
  sessionToken?: string | null
  /** Signs and checks a paid order's download links; null where CREDENTIALS_KEK isn't set. */
  downloadLinks?: LinkSigner | null
  /** The download limiter (DOWNLOAD_RATE_LIMITER) by key, its own budget apart from sign-in's; refuses every download where it isn't bound. */
  allowDownload?: (key: string) => Promise<boolean>
  /** The new-cart limiter (CART_RATE_LIMITER) by key; the Worker refuses to serve without it. */
  allowNewCart: (key: string) => Promise<boolean>
  /** The offer-code limiter (OFFER_CODE_RATE_LIMITER) by key, so codes can't be guessed; refuses every code where it isn't bound. */
  allowCodeAttempt?: (key: string) => Promise<boolean>
  now: () => Date
}

export const storeUnavailable = () => new GraphQLError('This shop isn’t open right now.', { extensions: { code: 'STORE_UNAVAILABLE' } })

// A suspended or closed store's storefront shows its notice from the edge (storefront ARCHITECTURE §4.2), never its catalogue.
export const shopPolicy: AccessPolicy<ShopContext> = {
  api: 'shop',
  scopes: ['public', 'shop'],
  permissions: [],
  authorize: async (_, ctx) => {
    if (!ctx.sql || !ctx.shopper?.available) throw storeUnavailable()
  },
}

/** The shopper and the database, once the policy has let the request through. */
export const shopOf = (ctx: ShopContext): { sql: postgres.Sql; shopper: Shopper } => {
  if (!ctx.sql || !ctx.shopper) throw storeUnavailable()
  return { sql: ctx.sql, shopper: ctx.shopper }
}

/** Test on a preview storefront, live everywhere else (storefront ARCHITECTURE §4.1). */
export const paymentModeOf = (shopper: Shopper): PaymentMode => (shopper.preview ? 'test' : 'live')

/** Stripe Tax on the store's connected account, in the storefront's mode; null where it can't be asked. */
export const stripeTaxOf = (ctx: ShopContext): StripeTaxDeps | null => {
  const { sql, shopper } = shopOf(ctx)
  const calculate = ctx.payments?.stripeTax(paymentModeOf(shopper)) ?? null
  if (!calculate) return null
  // In system scope: a shopper never reads the connected account's id (DATA-MODEL §7.11).
  return { accountId: () => withSystemScope(sql, (tx) => selectStripeAccountId(tx, shopper.context.storeId)), calculate }
}
