import { describe, expect, it } from 'vitest'
import { blankDetails, detailsOf, kindChanged, kindInputOf, kindProblemsOf, keysOf } from './kindDetails'

const view = { productId: 'p1', productType: 'digital', revision: 2, download: null, service: null, giftCard: null }

describe('a kind’s own details', () => {
  it('start from what is stored, over the API’s defaults for the other kinds', () => {
    expect(detailsOf(null)).toEqual(blankDetails())
    const keys = detailsOf({ ...view, download: { mode: 'keys', file: null, limit: 3, days: 7, keysLeft: 4, keysSold: 1 } })
    expect(keys.download).toEqual({ mode: 'keys', file: null, limit: 3, days: 7 })
    expect(keys.keys).toBe('')
    expect(detailsOf({ ...view, productType: 'service', service: { duration: '2 hours', location: null } }).service).toEqual({ duration: '2 hours', location: '' })
    expect(detailsOf({ ...view, productType: 'gift_card', giftCard: { expiryMonths: 60, shortestMonths: 60 } }).giftCard).toEqual({ expiryMonths: 60 })
  })

  it('send only the product’s own kind, a key pool without a file and empty service fields as none', () => {
    const d = blankDetails()
    expect(kindInputOf('physical', d)).toBeNull()
    expect(kindInputOf('digital', { ...d, download: { ...d.download, file: { id: 'f1', mime: 'application/pdf', bytes: 1 } } })).toEqual({ download: { mode: 'file', fileId: 'f1', limit: 5, days: 30 } })
    expect(kindInputOf('digital', { ...d, download: { mode: 'keys', file: { id: 'f1', mime: 'application/pdf', bytes: 1 }, limit: 5, days: 30 } })).toEqual({ download: { mode: 'keys', fileId: null, limit: 5, days: 30 } })
    expect(kindInputOf('service', { ...d, service: { duration: ' ', location: ' Studio ' } })).toEqual({ service: { duration: null, location: 'Studio' } })
    expect(kindInputOf('gift_card', d)).toEqual({ giftCard: { expiryMonths: null } })
  })

  it('need saving for a new kind or changed details, never for keys alone', () => {
    const d = blankDetails()
    expect(kindChanged('service', d, 'physical', d)).toBe(true)
    expect(kindChanged('service', d, 'service', d)).toBe(false)
    expect(kindChanged('digital', { ...d, keys: 'K-1' }, 'digital', d)).toBe(false)
    expect(kindChanged('service', { ...d, download: { ...d.download, limit: 10 } }, 'service', d)).toBe(false)
    expect(kindChanged('digital', { ...d, download: { ...d.download, limit: 10 } }, 'digital', d)).toBe(true)
    expect(kindChanged('service', { ...d, giftCard: { expiryMonths: 12 } }, 'service', d)).toBe(false)
    expect(kindChanged('gift_card', { ...d, giftCard: { expiryMonths: 12 } }, 'gift_card', d)).toBe(true)
  })

  it('stop a download without its file, and more or longer keys than a save takes', () => {
    const d = blankDetails()
    expect(kindProblemsOf('digital', d)).toEqual(['file'])
    expect(kindProblemsOf('service', d)).toEqual([])
    const keys = { ...d, download: { ...d.download, mode: 'keys' as const } }
    expect(kindProblemsOf('digital', keys)).toEqual([])
    expect(kindProblemsOf('digital', { ...keys, keys: Array.from({ length: 1001 }, (_, i) => `K-${i}`).join('\n') })).toEqual(['keys'])
    expect(kindProblemsOf('digital', { ...keys, keys: 'x'.repeat(201) })).toEqual(['keys'])
    expect(keysOf(' A \n\nB\nA')).toEqual(['A', 'B'])
  })
})
