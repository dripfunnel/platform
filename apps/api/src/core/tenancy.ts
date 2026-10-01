// Who is asking and what they may reach (ACCESS.md §3), built on the server from the
// resolved caller. #13 and #14 add the resolution that produces one.

export type Scope = 'store' | 'partner' | 'platform' | 'shop' | 'system'

// No default, so forgetting the vendor filter is a type error (ACCESS.md §3).
export type SellerScope = { kind: 'all' } | { kind: 'seller'; sellerId: string }

export type StoreCaller =
  | { kind: 'person'; userId: string; sessionId: string }
  | { kind: 'shopper'; customerId: string | null }
  | { kind: 'api-key'; keyId: string; createdByUserId: string }
  | { kind: 'app'; grantId: string; appId: string }
  | { kind: 'impersonation'; impersonationId: string; staffId: string; userId: string }
  | { kind: 'support'; supportSessionId: string; partnerUserId: string; access: 'read' | 'write' }

export type Subscription = 'trialing' | 'active' | 'past_due' | 'canceled' | 'suspended'

export interface TenantContext {
  caller: StoreCaller
  /** The store's partner. The router checks it against the host's (ACCESS.md §9 check 10). */
  partnerId: string
  /** Resolved server-side, never taken from input as authority. */
  storeId: string
  sellerScope: SellerScope
  subscription: Subscription
}

/** A partner user or a staff setup session on the Platform API: no store, no seller scope. */
export interface PartnerContext {
  caller: { kind: 'partner-user'; partnerUserId: string } | { kind: 'staff-setup'; staffId: string; setupSessionId: string }
  partnerId: string
}

/** Staff on the Admin API: every partner, at account level. */
export interface StaffContext {
  caller: { kind: 'staff'; staffId: string }
}

export type CallerContext = TenantContext | PartnerContext | StaffContext

export const isTenantContext = (context: CallerContext): context is TenantContext =>
  'storeId' in context

export const isPartnerContext = (context: CallerContext): context is PartnerContext =>
  !('storeId' in context) && 'partnerId' in context
