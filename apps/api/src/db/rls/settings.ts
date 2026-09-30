import type { CallerContext, Scope } from '#core/tenancy'
import { isPartnerContext, isTenantContext } from '#core/tenancy'

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
}

const empty = {
  'app.partner_id': '',
  'app.store_id': '',
  'app.seller_id': '',
  'app.customer_id': '',
  'app.support': '' as const,
  'app.impersonation_id': '',
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
    }
  }
  if (isPartnerContext(context)) {
    return { ...empty, 'app.scope': 'partner', 'app.partner_id': context.partnerId }
  }
  return { ...empty, 'app.scope': 'platform' }
}
