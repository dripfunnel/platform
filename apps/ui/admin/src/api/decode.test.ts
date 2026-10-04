import { describe, expect, it } from 'vitest'
import { filterOf } from './decode'

describe('filterOf', () => {
  it('keeps only the keys the API declares, and drops the empty ones', () => {
    const search = { partner: 'p1', status: undefined, state: 'empty', after: 'c1' }
    expect(filterOf(search, ['partner', 'status'])).toEqual({ partner: 'p1' })
  })
})

describe('the Impersonate role filter', () => {
  it('goes out as the API’s role key, an Owner by the type asked for', async () => {
    const { roleKeyOf } = await import('./impersonation')
    expect(roleKeyOf('readOnly', undefined)).toBe('partner-read-only')
    expect(roleKeyOf('admin', undefined)).toBe('partner-admin')
    expect(roleKeyOf('supplierAdmin', undefined)).toBe('supplier-admin')
    expect(roleKeyOf('manager', undefined)).toBe('manager')
    expect(roleKeyOf('owner', 'partnerUser')).toBe('partner-owner')
    expect(roleKeyOf('owner', 'storeUser')).toBe('owner')
  })
})
