import { describe, expect, it } from 'vitest'
import { staffRoles, type StaffRole } from './features/shell/staffRoles'
import { navFor, navRows, type NavRow } from './nav'

const firstRelease = ['dashboard', 'partners', 'stores', 'customers']

const rowFor = (roles: readonly StaffRole[]): NavRow => ({ key: 'partners', to: '/partners', icon: 'users', roles })

describe('navFor', () => {
  it.each(staffRoles)('gives %s exactly Dashboard, Partners, Stores and Customers, in that order', (role) => {
    expect(navFor(role).map((row) => row.key)).toEqual(firstRelease)
  })

  it.each(staffRoles)('leaves out, for %s, a row that lists only the other roles', (role) => {
    const others = rowFor(staffRoles.filter((other) => other !== role))
    const own = rowFor([role])
    expect(navFor(role, [others, own])).toEqual([own])
  })

  it('points every row at its own screen', () => {
    for (const row of navRows) expect(row.to).toBe(`/${row.key}`)
  })
})
