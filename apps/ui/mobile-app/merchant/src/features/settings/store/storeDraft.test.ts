import type { StoreInfo, StoreLocale } from '../../../api/settingsStore'
import { addableCurrencies, cleanNumber, cleanPrefix, countryWords, exampleOf, formOf, inputOf, isDirty, problemOf, sameCurrencies } from './storeDraft'

const info: StoreInfo = {
  name: 'Kesari Threads',
  legalName: null,
  description: 'Handloom',
  logoAssetId: null,
  address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: null },
  contactEmail: 'hello@kesarithreads.in',
  contactPhone: null,
  country: 'IN',
  taxId: null,
  timeZone: 'Asia/Kolkata',
  unitSystem: 'metric',
  orderPrefix: 'kt-',
  nextOrderNumber: '1042',
}

const locale: StoreLocale = {
  pricingCurrency: 'INR',
  mainLanguage: 'en-IN',
  offeredLanguages: ['en-IN', 'hi-IN'],
  currencies: [{ code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'active' }],
  languages: [{ code: 'en-IN', status: 'active' }],
  examples: [
    { currency: 'USD', publishedOn: '2026-10-05', from: { amount: '10000', currency: 'INR' }, none: { amount: '120' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
    { currency: 'AED', publishedOn: null, from: { amount: '10000', currency: 'INR' }, none: null, nearest: null, ends99: null },
    { currency: 'GBP', publishedOn: '2026-10-04', from: { amount: '10000', currency: 'INR' }, none: { amount: '84' }, nearest: { amount: '100' }, ends99: { amount: '199' } },
  ],
}

describe('the store info form', () => {
  it('holds what the API sent, with empty text for what it had none of', () => {
    expect(formOf(info)).toMatchObject({ legalName: '', contactPhone: '', taxId: '', address: { region: '' }, nextOrderNumber: '1042' })
  })

  it('goes back to the API in its input shape: the prefix upper-case, the number a number', () => {
    expect(inputOf(formOf(info))).toEqual({
      name: 'Kesari Threads',
      legalName: '',
      description: 'Handloom',
      logoAssetId: null,
      address: { street: '14 Johari Bazaar', city: 'Jaipur', postal: '302003', region: '' },
      contactEmail: 'hello@kesarithreads.in',
      contactPhone: '',
      taxId: '',
      timeZone: 'Asia/Kolkata',
      unitSystem: 'metric',
      orderPrefix: 'KT-',
      nextOrderNumber: 1042,
    })
  })

  it('says what is missing before the API would: a name, and an order number of 1 or more', () => {
    expect(problemOf({ ...formOf(info), name: '  ' })).toBe('nameMissing')
    expect(problemOf({ ...formOf(info), nextOrderNumber: '' })).toBe('nextMissing')
    expect(problemOf({ ...formOf(info), nextOrderNumber: '0' })).toBe('nextMissing')
    expect(problemOf(formOf(info))).toBeNull()
  })

  it('is dirty only when something changed', () => {
    expect(isDirty(formOf(info), formOf(info))).toBe(false)
    expect(isDirty({ ...formOf(info), name: 'Other' }, formOf(info))).toBe(true)
  })

  it('keeps the prefix to letters, numbers and dashes and the number to digits', () => {
    expect(cleanPrefix('kt_-1 !')).toBe('KT-1')
    expect(cleanNumber('10 42a')).toBe('1042')
  })

  it('words the address and tax number in the home country’s terms', () => {
    expect([countryWords('IN'), countryWords('US'), countryWords('GB'), countryWords(null)]).toEqual(['IN', 'US', 'other', 'other'])
  })
})

describe('currencies', () => {
  it('offers those the API has a reference rate for, not the main one nor one already added', () => {
    expect(addableCurrencies(locale, locale.currencies)).toEqual(['AED', 'GBP'])
  })

  it('compares a list by code, mode and rounding', () => {
    expect(sameCurrencies(locale.currencies, [{ code: 'USD', mode: 'convert', rounding: 'ends-99', status: 'pending' }])).toBe(true)
    expect(sameCurrencies(locale.currencies, [{ code: 'USD', mode: 'manual', rounding: 'ends-99', status: 'active' }])).toBe(false)
  })

  it('shows the API’s worked example for the rounding in force, never working a rate out', () => {
    expect(exampleOf('USD', 'ends-99', locale.examples)?.text).toBe('₹100.00 → $1.99')
    expect(exampleOf('USD', 'none', locale.examples)).toMatchObject({ date: '2026-10-05' })
    expect(exampleOf('AED', 'none', locale.examples)).toBeNull()
    expect(exampleOf('JPY', 'none', locale.examples)).toBeNull()
  })
})
