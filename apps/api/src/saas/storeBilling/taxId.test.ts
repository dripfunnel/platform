import { describe, expect, it } from 'vitest'
import { invoiceTaxIdOf } from './index'

describe('the tax number on invoices (SAAS §7.2)', () => {
  it('reads a GSTIN in India and a VAT number in the EU, as Store info reads them', () => {
    expect(invoiceTaxIdOf('29aakcd1234q1z2', 'IN')).toEqual({ tax_id: '29AAKCD1234Q1Z2', tax_id_kind: 'gstin' })
    expect(invoiceTaxIdOf('DE 312 345 678', 'DE')).toEqual({ tax_id: 'DE312345678', tax_id_kind: 'vat' })
  })

  it('takes none as none, and refuses a malformed GSTIN or a country with no such number on these invoices', () => {
    expect(invoiceTaxIdOf('', 'US')).toBeNull()
    expect(invoiceTaxIdOf(null, 'IN')).toBeNull()
    expect(invoiceTaxIdOf('29AAKCD1234Q1Z', 'IN')).toBe(false)
    expect(invoiceTaxIdOf('12-3456789', 'US')).toBe(false)
    expect(invoiceTaxIdOf('GB123456789', 'GB')).toBe(false)
  })
})
