import { describe, expect, it } from 'vitest'
import { staffRoles } from './features/shell/staffRoles'
import { navFor, navRows } from './nav'

const firstRelease = ['dashboard', 'partners', 'stores']
const notInThisRelease = ['customers', 'approvals', 'provisioning', 'impersonate', 'activity', 'staff']

describe('navFor', () => {
  it.each(staffRoles)('gives %s Dashboard, Partners and Stores, in that order', (role) => {
    expect(navFor(role).map((row) => row.key)).toEqual(firstRelease)
  })

  it.each(staffRoles)('gives %s none of the menus that are not in this release', (role) => {
    const keys: readonly string[] = navFor(role).map((row) => row.key)
    for (const key of notInThisRelease) expect(keys).not.toContain(key)
  })

  it('leaves a row out for a role the row does not list', () => {
    const rows = navRows.filter((row) => row.roles.includes('staff-read-only'))
    expect(navFor('staff-read-only')).toEqual(rows)
  })

  it('points every row at its own screen', () => {
    for (const row of navRows) expect(row.to).toBe(`/${row.key}`)
  })
})
