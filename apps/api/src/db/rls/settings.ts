import type { CallerContext, Scope } from '#core/tenancy'
import { isPartnerContext, isTenantContext } from '#core/tenancy'

/** The database role each caller kind runs as (DATA-MODEL.md §5.3); shoppers as `app_shop` since #306. */
export type RequestRole = 'app_request' | 'app_supplier' | 'app_shop' | 'app_partner' | 'app_platform'

// Exhaustive and failing closed: a context kind added later throws until it is named here, so it
// can never run as staff by default.
export const roleFor = (context: CallerContext): RequestRole => {
  if (isTenantContext(context)) {
    if (context.caller.kind === 'shopper') return 'app_shop'
    return context.sellerScope.kind === 'seller' ? 'app_supplier' : 'app_request'
  }
  if (isPartnerContext(context)) return 'app_partner'
  if (context.caller.kind === 'staff') return 'app_platform'
  throw new Error('roleFor: unknown caller kind')
}

// The per-transaction settings of DATA-MODEL.md §5.1, from the caller's context and never
// from request input. `boundary.test.ts` holds them to this file and `db/scoped`.
export interface RlsSettings {
  'app.scope': Scope
  'app.partner_id': string
  'app.store_id': string
  'app.seller_id': string
  'app.customer_id': string
  'app.support': '' | 'read' | 'write'
  'app.impersonation_id': string
  'app.user_id': string
  /** The signed-in staff member (platform scope): who may start an impersonation as themselves (0030). */
  'app.staff_id': string
}

const empty = {
  'app.partner_id': '',
  'app.store_id': '',
  'app.seller_id': '',
  'app.customer_id': '',
  'app.support': '' as const,
  'app.impersonation_id': '',
  'app.user_id': '',
  'app.staff_id': '',
}

export const settingsFor = (context: CallerContext): RlsSettings => {
  if (isTenantContext(context)) {
    const { caller } = context
    return {
      ...empty,
      // A shopper reaches the Shop API; every other store caller reaches the Store API.
      'app.scope': caller.kind === 'shopper' ? 'shop' : 'store',
      'app.partner_id': context.partnerId,
      'app.store_id': context.storeId,
      'app.seller_id': context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : '',
      'app.customer_id': caller.kind === 'shopper' && caller.customerId ? caller.customerId : '',
      // Read-only until the merchant elevates it (ACCESS.md §8).
      'app.support': caller.kind === 'support' ? caller.access : '',
      // Grants nothing; it attributes the write (LOGGING.md §4).
      'app.impersonation_id': caller.kind === 'impersonation' ? caller.impersonationId : '',
      'app.user_id': caller.kind === 'person' ? caller.userId : '',
    }
  }
  if (isPartnerContext(context)) {
    const { caller } = context
    return {
      ...empty,
      'app.scope': 'partner',
      'app.partner_id': context.partnerId,
      // An impersonation runs as the user it acts as (DATA-MODEL.md §5.3); the id attributes, never grants.
      'app.user_id': caller.kind === 'staff-setup' ? '' : caller.partnerUserId,
      'app.impersonation_id': caller.kind === 'impersonation' ? caller.impersonationId : '',
    }
  }
  return { ...empty, 'app.scope': 'platform', 'app.staff_id': context.caller.staffId }
}
