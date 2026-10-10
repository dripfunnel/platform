import { describe, expect, it } from 'vitest'
import { partnerScopedRoles, roleHas, staffPermissions, type StaffPermission } from './permissions'
import { staffRoles, type StaffRole } from './staff'

// ACCESS.md §5.4's table, written out again so a change to either shows in review (§11.2).
// Columns: Super admin, Partner manager, Support, Finance, Engineer on call, Read-only.
const table: Record<StaffPermission, string> = {
  'partners.read': 'SA PM SU FI EN RO',
  'stores.read': 'SA PM SU FI EN RO',
  'customers.read': 'SA PM SU FI EN RO',
  'activity.read': 'SA PM SU FI EN RO',
  'customers.contact.read': 'SA SU',
  'partners.create': 'SA PM',
  'partners.approve': 'SA PM',
  'partners.setup': 'SA PM',
  'partners.invite': 'SA PM',
  'partners.invite.resend': 'SA PM SU',
  'partners.pause': 'SA',
  'stores.suspend': 'SA EN',
  'stores.restore': 'SA',
  'stores.trial.extend': 'SA',
  'stores.invite.resend': 'SA SU',
  'stores.notes.write': 'SA PM SU EN',
  'domains.recheck': 'SA EN',
  'provisioning.read': 'SA SU EN',
  'provisioning.retry': 'SA SU EN',
  'provisioning.undo': 'SA EN',
  impersonate: 'SA SU',
  'setupSessions.read': 'SA PM SU',
  'staffSessions.endAny': 'SA',
  'activity.export': 'SA EN',
  'staff.manage': 'SA',
  'partners.assign': 'SA',
  'apps.manage': 'SA',
}

const column: Record<StaffRole, string> = {
  'staff-super-admin': 'SA',
  'staff-partner-manager': 'PM',
  'staff-support': 'SU',
  'staff-finance': 'FI',
  'staff-engineer': 'EN',
  'staff-read-only': 'RO',
}

const expectedHas = (role: StaffRole, permission: StaffPermission) =>
  table[permission].split(' ').includes(column[role])

describe.each(staffRoles)('%s', (role) => {
  const cases = staffPermissions.map((p) => [`${expectedHas(role, p) ? 'may' : 'may not'} ${p}`, p] as const)

  it.each(cases)('%s', (_, permission) => {
    expect(roleHas(role, permission)).toBe(expectedHas(role, permission))
  })
})

describe('the catalogue', () => {
  it('is exactly the table: no permission without a screen', () => {
    expect(Object.keys(table).sort()).toEqual([...staffPermissions].sort())
  })

  it('scopes only the Partner manager to assigned partners', () => {
    expect(partnerScopedRoles).toEqual(['staff-partner-manager'])
  })
})
