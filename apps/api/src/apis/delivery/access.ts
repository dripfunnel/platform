import { GraphQLError } from 'graphql'
import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { CodeCheck } from '#auth/codeCheck'
import type { SecretBox } from '#auth/secretBox'
import type { DeliveryCaller } from '#auth/riderCaller'
import type { RiderFiles } from '#engine/modules/ownDelivery/index'
import { unauthenticated, type AccessPolicy } from '../graphql/scope'

export interface DeliveryContext extends Record<string, unknown> {
  /** Null when the Worker has no database: every field then answers STORE_UNAVAILABLE. */
  sql: postgres.Sql | null
  /** The host's store and the signed-in rider, found before the request reaches here (auth/riderCaller.ts). */
  caller: DeliveryCaller | null
  activity: ActivityLog
  facts: RequestFacts
  /** The sign-in limiter (SIGN_IN_RATE_LIMITER) by key; refuses everything where it isn't bound. */
  allowAttempt?: (key: string) => Promise<boolean>
  codeCheck?: CodeCheck
  /** Work past the response (the Worker's `waitUntil`): a code's look-up and text (DELIVERY §4). */
  defer: (work: Promise<unknown>) => void
  /** The assets bucket (ASSETS): riders' photos, uploaded and deleted with an account; null where it isn't bound. */
  files?: RiderFiles | null
  /** The credentials key: a handover code is sealed with it at assignment and checked at the door (DELIVERY §3). */
  secrets?: SecretBox | null
  now: () => Date
}

export const storeUnavailable = () => new GraphQLError('This shop isn’t delivering right now.', { extensions: { code: 'STORE_UNAVAILABLE' } })

// `rider` fields need a signed-in, active rider of the host's store; `public` ones (sign-in) check the store themselves.
export const deliveryPolicy: AccessPolicy<DeliveryContext> = {
  api: 'delivery',
  scopes: ['public', 'rider'],
  permissions: [],
  authorize: async (access, ctx) => {
    if (!ctx.sql || !ctx.caller?.available) throw storeUnavailable()
    if (access.scope === 'rider' && !ctx.caller.rider) throw unauthenticated()
  },
}

/** The store and the database, for sign-in. */
export const storeOf = (ctx: DeliveryContext): { sql: postgres.Sql; caller: DeliveryCaller } => {
  if (!ctx.sql || !ctx.caller?.available) throw storeUnavailable()
  return { sql: ctx.sql, caller: ctx.caller }
}

/** The signed-in rider, once the policy has let the request through. */
export const riderOf = (ctx: DeliveryContext) => {
  const { sql, caller } = storeOf(ctx)
  if (!caller.rider) throw unauthenticated()
  return { sql, rider: caller.rider }
}
