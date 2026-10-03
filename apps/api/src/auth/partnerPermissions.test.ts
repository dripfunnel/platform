import { describe, expect, it } from 'vitest'
import { partnerPermissions, partnerRoleHas, partnerRoles, type PartnerPermission, type PartnerRole } from './partnerPermissions'

// ACCESS.md §5.3's table, written out again so a change to either shows in review (§11.2).
// Columns: Owner, Admin, Support, Finance, Read-only.
const table: Record<PartnerPermission, string> = {
  'partner.read': 'OW AD SU FI RO',
  'onboarding.submit': 'OW AD',
  'branding.write': 'OW AD',
  'domains.write': 'OW AD',
  'domains.recheck': 'OW AD SU FI RO',
  'plans.write': 'OW AD',
  'plans.price': 'OW AD FI',
  'stores.create': 'OW AD',
  'stores.plan': 'OW AD',
  'stores.trial': 'OW AD FI',
  'stores.suspend': 'OW AD',
  'stores.invite.resend': 'OW AD',
  'setup.retry': 'OW AD',
  'stores.billingStatus': 'OW AD FI',
  'billing.read': 'OW AD FI RO',
  'billing.write': 'OW FI',
  'payout.write': 'OW FI',
  'card.write': 'OW FI',
  'support.session': 'OW AD SU',
  exports: 'OW AD SU FI RO',
  'team.manage': 'OW AD',
  'team.transfer': 'OW',
  'security.manage': 'OW',
}

const column: Record<PartnerRole, string> = {
  'partner-owner': 'OW',
  'partner-admin': 'AD',
  'partner-support': 'SU',
  'partner-finance': 'FI',
  'partner-read-only': 'RO',
}

const expectedHas = (role: PartnerRole, permission: PartnerPermission) => table[permission].split(' ').includes(column[role])

describe.each(partnerRoles)('%s', (role) => {
  const cases = partnerPermissions.map((p) => [`${expectedHas(role, p) ? 'may' : 'may not'} ${p}`, p] as const)

  it.each(cases)('%s', (_, permission) => {
    expect(partnerRoleHas(role, permission)).toBe(expectedHas(role, permission))
  })
})

describe('the catalogue', () => {
  it('is exactly the table: no permission without a screen', () => {
    expect(Object.keys(table).sort()).toEqual([...partnerPermissions].sort())
  })
})
