import { describe, expect, it } from 'vitest'
import { classifySearch, maskEmail, maskPhone } from './mask'

describe('masking', () => {
  it('masks an email to its first two letters and its domain', () => {
    expect(maskEmail('priya@gmail.com')).toBe('pr***@gmail.com')
    expect(maskEmail('anna@example.com')).toBe('a***@example.com')
    expect(maskEmail('jo@example.com')).toBe('***@example.com')
    expect(maskEmail('a@example.com')).toBe('***@example.com')
    expect(maskEmail(null)).toBeNull()
  })

  it('masks a phone to its calling code and last five digits', () => {
    expect(maskPhone('+919876543210', '91')).toBe('+91 ***** 43210')
    expect(maskPhone('+14155550132', '1')).toBe('+1 ***** 50132')
    expect(maskPhone('+3531234567', '353')).toBe('+353 ***** 67')
    expect(maskPhone(null, null)).toBeNull()
  })
})

describe('classifySearch', () => {
  it('reads an email, a phone by its digits, or a name, and nothing too short to mean one', () => {
    expect(classifySearch(' Priya@Gmail.com ')).toEqual({ kind: 'email', email: 'Priya@Gmail.com' })
    expect(classifySearch('+91 98765-43210')).toEqual({ kind: 'phone', digits: '919876543210' })
    expect(classifySearch('(987) 654 3210')).toEqual({ kind: 'phone', digits: '9876543210' })
    expect(classifySearch('Priya S')).toEqual({ kind: 'name', term: 'Priya S' })
    expect(classifySearch('123')).toBeNull()
    expect(classifySearch('P')).toBeNull()
  })
})
