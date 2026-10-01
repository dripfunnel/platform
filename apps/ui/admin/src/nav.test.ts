import { describe, expect, it } from 'vitest'
import { staffRoles, type StaffRole } from './features/shell/staffRoles'
import { navFor, navRows, type NavRow } from './nav'

const everyone = ['dashboard', 'partners', 'stores', 'customers']

const menusOf: Record<StaffRole, readonly string[]> = {
  'staff-super-admin': [...everyone, 'approvals', 'provisioning', 'activity'],
  'staff-partner-manager': [...everyone, 'approvals', 'activity'],
  'staff-support': [...everyone, 'provisioning', 'activity'],
  'staff-finance': [...everyone, 'activity'],
  'staff-engineer': [...everyone, 'provisioning', 'activity'],
  'staff-read-only': [...everyone, 'activity'],
}

const rowFor = (roles: readonly StaffRole[]): NavRow => ({ key: 'partners', to: '/partners', icon: 'users', roles })

describe('navFor', () => {
  it.each(staffRoles)('gives %s its FIRST-RELEASE §2 menus, in that order', (role) => {
    expect(navFor(role).map((row) => row.key)).toEqual(menusOf[role])
  })

  it.each(staffRoles)('leaves out, for %s, a row that lists only the other roles', (role) => {
    const others = rowFor(staffRoles.filter((other) => other !== role))
    const own = rowFor([role])
    expect(navFor(role, [others, own])).toEqual([own])
  })

  it.each(staffRoles)('shows %s the awaiting-approval badge on exactly one menu it can reach', (role) => {
    expect(navFor(role).filter((row) => row.badge === 'partnersAwaitingApproval')).toHaveLength(1)
  })

  it('puts the awaiting-approval badge on Approvals for approvers and on Partners for everyone else', () => {
    const badged = (role: StaffRole) => navFor(role).find((row) => row.badge === 'partnersAwaitingApproval')?.key
    expect(badged('staff-super-admin')).toBe('approvals')
    expect(badged('staff-partner-manager')).toBe('approvals')
    for (const role of ['staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) expect(badged(role)).toBe('partners')
  })

  it('points every row at its own screen', () => {
    for (const row of navRows) expect(row.to).toBe(`/${row.key}`)
  })
})
