import { describe, expect, it } from 'vitest'
import { taxIdOf } from './index'

describe('the tax number on invoices (SAAS §7.2)', () => {
  it('reads a GSTIN in India and a VAT number in the EU, spaces and case aside', () => {
    expect(taxIdOf('29aakcd1234q1z2', 'IN')).toEqual({ tax_id: '29AAKCD1234Q1Z2', tax_id_kind: 'gstin' })
    expect(taxIdOf('DE 312 345 678', 'DE')).toEqual({ tax_id: 'DE312345678', tax_id_kind: 'vat' })
    expect(taxIdOf('EL123456789', 'GR')).toEqual({ tax_id: 'EL123456789', tax_id_kind: 'vat' })
  })

  it('takes none as none, and refuses one of the wrong shape or country', () => {
    expect(taxIdOf('', 'US')).toBeNull()
    expect(taxIdOf(null, 'IN')).toBeNull()
    expect(taxIdOf('29AAKCD1234Q1Z', 'IN')).toBe(false)
    expect(taxIdOf('FR12345678901', 'DE')).toBe(false)
    expect(taxIdOf('12-3456789', 'US')).toBe(false)
  })
})
