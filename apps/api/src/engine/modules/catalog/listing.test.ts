import { describe, expect, it } from 'vitest'
import { cleanBadge, cleanListing, cleanSizeChart, ListingInvalid } from './listing'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const refused = (work: () => unknown) => {
  try {
    work()
    return null
  } catch (error) {
    return error instanceof ListingInvalid ? error.field : 'thrown'
  }
}

describe('a product’s listing sections', () => {
  it('cleans only the sections given, and keeps the rest out of the write', () => {
    expect(cleanListing({ highlights: [' Soft cotton '] }, 1, false)).toEqual({ highlights: ['Soft cotton'] })
    expect(cleanListing({}, 1, false)).toEqual({})
    expect(cleanListing({ marketRule: null }, 1, true)).toEqual({ marketRule: null })
  })

  it('reads specs on the product or a version, and flags and compliance', () => {
    const clean = cleanListing({ specs: [{ name: 'Material', value: 'Cotton' }, { name: 'Storage', value: '128 GB', version: 1 }], ageRestricted: true, compliance: [{ region: 'eu', field: 'country_of_origin', value: 'India' }] }, 2, false)
    expect(clean).toEqual({
      specs: [{ name: 'Material', value: 'Cotton', version: null, filterValueId: null }, { name: 'Storage', value: '128 GB', version: 1, filterValueId: null }],
      flags: { ageRestricted: true, hazardous: false },
      compliance: [{ region: 'EU', field: 'country_of_origin', value: 'India' }],
    })
  })

  it('refuses what the sections can’t hold', () => {
    expect(refused(() => cleanListing({ highlights: ['a', 'b', 'c', 'd', 'e', 'f'] }, 1, false))).toBe('highlights')
    expect(refused(() => cleanListing({ specs: [{ name: 'x', value: 'y', version: 3 }] }, 1, false))).toBe('specs')
    expect(refused(() => cleanListing({ relatedIds: ['nope'] }, 1, false))).toBe('related')
    expect(refused(() => cleanListing({ compliance: [{ region: 'EU', field: 'a_b', value: 'x' }, { region: 'eu', field: 'a_b', value: 'y' }] }, 1, false))).toBe('compliance')
    expect(refused(() => cleanListing({ marketRule: { mode: 'only', countries: ['ZZ'] } }, 1, true))).toBe('marketRule')
    expect(refused(() => cleanListing({ marketRule: { mode: 'only', countries: ['QQ'] } }, 1, true))).toBe('marketRule')
    expect(refused(() => cleanListing({ marketRule: { mode: 'maybe', countries: ['IN'] } }, 1, true))).toBe('marketRule')
    expect(cleanListing({ marketRule: { mode: 'except', countries: ['in', 'IN', 'us'] } }, 1, true)).toEqual({ marketRule: { mode: 'except', countries: ['IN', 'US'] } })
    expect(cleanListing({ badgeIds: [id(1), id(1).toUpperCase()] }, 1, false)).toEqual({ badgeIds: [id(1)] })
  })
})

describe('a size chart', () => {
  const chart = { name: "Men's shirts", unit: 'cm', systems: ['US', 'EU'], measurements: ['Chest', 'Length'], rows: [{ size: 'M', values: ['40', '50', '96–101', '72'] }] }

  it('takes a value in every cell, size systems first, ranges allowed', () => {
    expect(cleanSizeChart(chart)).toMatchObject({ unit: 'cm', systems: ['US', 'EU'], rows: [{ size: 'M', values: ['40', '50', '96–101', '72'] }] })
  })

  it('refuses a short row, a repeated measurement, a note for none, and an unknown unit', () => {
    expect(refused(() => cleanSizeChart({ ...chart, rows: [{ size: 'M', values: ['40'] }] }))).toBe('rows')
    expect(refused(() => cleanSizeChart({ ...chart, measurements: ['Chest', 'chest'] }))).toBe('measurements')
    expect(refused(() => cleanSizeChart({ ...chart, howToMeasure: [{ measurement: 'Hips', text: 'Around' }] }))).toBe('howToMeasure')
    expect(refused(() => cleanSizeChart({ ...chart, unit: 'mm' }))).toBe('unit')
  })
})

describe('a badge', () => {
  it('has a label of up to 18 characters, a tone and one rule', () => {
    expect(cleanBadge({ label: 'Handmade', tone: 'peach', rule: 'manual' })).toEqual({ label: 'Handmade', tone: 'peach', rule: 'manual', position: 0 })
    expect(refused(() => cleanBadge({ label: 'A label far too long here', tone: 'ok', rule: 'manual' }))).toBe('label')
    expect(refused(() => cleanBadge({ label: 'Sale', tone: 'red', rule: 'manual' }))).toBe('badge')
  })
})
