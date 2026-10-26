import type postgres from 'postgres'
import type { Subscription, TenantContext } from '#core/tenancy'
import { withSystemScope } from '#db/scoped/index'
import { selectDeliveryStore } from '#db/scoped/riderSignIn'
import { liveSlugOf } from '#db/scoped/shopCaller'
import { resolveRiderSession } from './riderAuth'
import { bearerOf } from './storeCredential'

// A Delivery API request's store and rider (ACCESS §3; DELIVERY §4): the store from its `{slug}.<SHOP_DOMAIN>` host alone,
// the rider from a bearer session of that store. No cookie is read, so there is no Origin to check (storeCredential.ts).

export interface DeliveryCaller {
  storeId: string
  partnerId: string
  /** Trial, active and past due stores deliver; a suspended or cancelled one answers STORE_UNAVAILABLE. */
  available: boolean
  /** The signed-in rider's context, or null: signed out, another store's token, or a rider no longer active. */
  rider: (TenantContext & { caller: { kind: 'rider'; riderId: string } }) | null
  /** The token presented, for signing out. */
  token: string | null
}

export const resolveRider = async (sql: postgres.Sql, request: Request, host: string, shopDomain: string | null, now: Date): Promise<DeliveryCaller | null> => {
  const slug = liveSlugOf(host, shopDomain)
  const store = slug === null ? null : await withSystemScope(sql, (tx) => selectDeliveryStore(tx, slug))
  if (!store) return null
  const token = bearerOf(request)
  const riderId = token ? await resolveRiderSession(sql, store.store_id, token, now) : null
  const subscription: Subscription = store.status === 'closed' ? 'cancelled' : store.status
  return {
    storeId: store.store_id,
    partnerId: store.partner_id,
    available: store.status === 'trial' || store.status === 'active' || store.status === 'past_due',
    rider: riderId ? { caller: { kind: 'rider', riderId }, partnerId: store.partner_id, storeId: store.store_id, sellerScope: { kind: 'all' }, subscription } : null,
    token,
  }
}
