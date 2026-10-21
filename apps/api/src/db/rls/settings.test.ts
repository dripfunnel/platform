import { describe, expect, it } from 'vitest'
import { roleFor, settingsFor } from './settings'

const partnerId = 'p'

describe('a Platform API caller’s database settings (DATA-MODEL.md §5.1, §5.3)', () => {
  it('runs an impersonation as the user acted as, with the impersonation named and nothing more', () => {
    const context = { caller: { kind: 'impersonation' as const, partnerUserId: 'pu', staffId: 'st', impersonationId: 'imp' }, partnerId }
    expect(roleFor(context)).toBe('app_partner')
    expect(settingsFor(context)).toMatchObject({ 'app.scope': 'partner', 'app.partner_id': partnerId, 'app.user_id': 'pu', 'app.impersonation_id': 'imp', 'app.staff_id': '' })
  })

  it('runs a setup session in the partner’s scope as no partner user', () => {
    const context = { caller: { kind: 'staff-setup' as const, staffId: 'st', setupSessionId: 'su' }, partnerId }
    expect(roleFor(context)).toBe('app_partner')
    expect(settingsFor(context)).toMatchObject({ 'app.scope': 'partner', 'app.partner_id': partnerId, 'app.user_id': '', 'app.impersonation_id': '', 'app.staff_id': '' })
  })

  it('runs a partner user as themselves', () => {
    const context = { caller: { kind: 'partner-user' as const, partnerUserId: 'pu' }, partnerId }
    expect(settingsFor(context)).toMatchObject({ 'app.user_id': 'pu', 'app.impersonation_id': '' })
  })
})

describe('a Shop API caller’s database settings (DATA-MODEL.md §5.3, #306)', () => {
  it('runs a shopper as app_shop in shop scope, signed in or not, and a store’s people as before', () => {
    const shopper = { caller: { kind: 'shopper' as const, customerId: null }, partnerId, storeId: 's', sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
    expect(roleFor(shopper)).toBe('app_shop')
    expect(settingsFor(shopper)).toMatchObject({ 'app.scope': 'shop', 'app.store_id': 's', 'app.customer_id': '' })
    expect(roleFor({ ...shopper, caller: { kind: 'shopper' as const, customerId: 'c' } })).toBe('app_shop')
    expect(roleFor({ ...shopper, caller: { kind: 'person' as const, userId: 'u', sessionId: 'x' } })).toBe('app_request')
  })
})
