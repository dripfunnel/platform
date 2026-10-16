import { maxPostalCodes, readPostalCodes } from './postalCodes'

describe('reading pasted delivery codes', () => {
  it('keeps the codes in the store’s country’s shape, once each, and leaves the rest out', () => {
    expect(readPostalCodes('302003, 302004\n302003; 12345 abc 0123456', 'IN')).toEqual({ kind: 'codes', codes: ['302003', '302004'] })
    expect(readPostalCodes('94105 94105-1234 9410', 'US')).toEqual({ kind: 'codes', codes: ['94105', '94105-1234'] })
  })

  it('takes any code with a digit and 3 to 10 letters or digits for another country', () => {
    expect(readPostalCodes('10115, 75001, ec1a, ab, abcd', 'DE')).toEqual({ kind: 'codes', codes: ['10115', '75001', 'EC1A'] })
  })

  it('says when nothing in it is a code', () => {
    expect(readPostalCodes('Jaipur, Udaipur', 'IN')).toEqual({ kind: 'none' })
    expect(readPostalCodes('', null)).toEqual({ kind: 'none' })
  })

  it('refuses a list longer than a store can have', () => {
    const many = Array.from({ length: maxPostalCodes + 1 }, (_, i) => String(100000 + i)).join(' ')

    expect(readPostalCodes(many, 'IN')).toEqual({ kind: 'tooMany' })
  })
})
