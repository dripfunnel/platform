import type postgres from 'postgres'
import { GraphQLError } from 'graphql'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { Shopper } from '#auth/shopCaller'
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
