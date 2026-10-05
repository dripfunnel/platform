import { describe, expect, it } from 'vitest'
import { merchantRoleOf, normalisedEmail } from './index'

describe('store People input', () => {
  it('takes only the three merchant roles', () => {
    expect(['owner', 'manager', 'staff'].map(merchantRoleOf)).toEqual(['owner', 'manager', 'staff'])
    expect(merchantRoleOf('supplier-admin')).toBeNull()
    expect(merchantRoleOf('Owner')).toBeNull()
  })

  it('trims an address and refuses what isn’t one', () => {
    expect(normalisedEmail('  meera@juniper.example ')).toBe('meera@juniper.example')
    expect(normalisedEmail('meera')).toBeNull()
    expect(normalisedEmail(`${'a'.repeat(320)}@b.example`)).toBeNull()
  })
})
