import { encode } from 'uqr'
import { describe, expect, it } from 'vitest'
import { qrPath } from './QrCode'

describe('qrPath', () => {
  it('draws one unit square per dark module of the encoded URI, inside a two-module quiet zone', () => {
    const uri = 'otpauth://totp/Kaufladen%20Digital%3Ajonas%40kaufladen.de?secret=JBSWY3DPEHPK3PXP&issuer=Kaufladen%20Digital'
    const { size, d } = qrPath(uri)
    const { data } = encode(uri, { ecc: 'M', border: 2 })
    expect(size).toBe(data.length)
    expect(d.match(/M/g)?.length).toBe(data.flat().filter(Boolean).length)
    expect(data[0]?.some(Boolean)).toBe(false)
    expect(data[2]?.[2]).toBe(true)
  })
})
