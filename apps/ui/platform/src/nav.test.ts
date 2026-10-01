import { describe, expect, it } from 'vitest'
import { partnerRoles, type PartnerRole } from './features/shell/partnerRoles'
import { navFor } from './nav'

// FIRST-RELEASE.md §2.1: ten rows; Billing absent for Support, Support absent for Finance and Read-only.
const expected: Record<PartnerRole, readonly string[]> = {
  'partner-owner': ['/dashboard', '/stores', '/plans', '/branding', '/domains', '/reports', '/billing', '/support', '/activity', '/settings'],
  'partner-admin': ['/dashboard', '/stores', '/plans', '/branding', '/domains', '/reports', '/billing', '/support', '/activity', '/settings'],
  'partner-support': ['/dashboard', '/stores', '/plans', '/branding', '/domains', '/reports', '/support', '/activity', '/settings'],
  'partner-finance': ['/dashboard', '/stores', '/plans', '/branding', '/domains', '/reports', '/billing', '/activity', '/settings'],
  'partner-read-only': ['/dashboard', '/stores', '/plans', '/branding', '/domains', '/reports', '/billing', '/activity', '/settings'],
}

describe('navFor', () => {
  it.each(partnerRoles)('gives %s exactly the menu FIRST-RELEASE §2.1 gives it, in the prototype’s order', (role) => {
    expect(navFor(role).map((row) => row.to)).toEqual(expected[role])
  })

  it('carries the five badge sources on the rows the spec names', () => {
    const badges = Object.fromEntries(navFor('partner-owner').filter((row) => row.badge).map((row) => [row.key, row.badge]))
    expect(badges).toEqual({ stores: 'storesAttention', branding: 'brandingSetupLeft', domains: 'domainsWaiting', billing: 'billingFailedPayments', support: 'supportOpenSessions' })
  })
})
