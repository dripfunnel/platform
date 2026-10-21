import { describe, expect, it } from 'vitest'
import { cleanCollection, cleanMenu, cleanRule } from './structure'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const refused = (work: () => unknown) => {
  try {
    work()
    return null
  } catch (error) {
    return error instanceof Error ? error.message : 'thrown'
  }
}

describe('collection rules', () => {
  it('reads each kind of rule and refuses a malformed one', () => {
    expect(cleanRule({ kind: 'filter_value', valueId: id(1) })).toEqual({ kind: 'filter_value', args: { valueId: id(1) } })
    expect(cleanRule({ kind: 'name_contains', text: ' linen ' })).toEqual({ kind: 'name_contains', args: { text: 'linen' } })
    expect(cleanRule({ kind: 'price_range', currency: 'INR', min: '0', max: '50000' })).toEqual({ kind: 'price_range', args: { currency: 'INR', min: '0', max: '50000' } })
    expect(refused(() => cleanRule({ kind: 'price_range', currency: 'INR', min: '500', max: '100' }))).toBe('INVALID_RULE')
    expect(refused(() => cleanRule({ kind: 'filter_value', valueId: 'nope' }))).toBe('INVALID_RULE')
    expect(refused(() => cleanRule({ kind: 'sql', text: 'drop' }))).toBe('INVALID_RULE')
    expect(refused(() => cleanRule({ kind: 'name_contains', text: '' }))).toBe('INVALID_RULE')
  })
})

describe('a collection before it is written', () => {
  it('keeps rules only on an automatic collection and products only on a hand-picked one', () => {
    const auto = cleanCollection({ name: 'Linen', kind: 'automatic', rules: [{ kind: 'name_contains', text: 'linen' }], productIds: [id(1)] })
    expect(auto).toMatchObject({ fields: { slug: 'linen', kind: 'automatic', sort: 'newest' }, productIds: [] })
    expect(auto.rules).toHaveLength(1)
    const manual = cleanCollection({ name: 'Picks', kind: 'manual', rules: [{ kind: 'name_contains', text: 'x' }], productIds: [id(2), id(1), id(2)] })
    expect(manual).toMatchObject({ rules: [], productIds: [id(2), id(1)], fields: { sort: 'manual' } })
  })

  it('limits a child to its parent only when it has one, and refuses the rest', () => {
    expect(cleanCollection({ name: 'A', kind: 'automatic', inheritParent: true }).fields.inheritParent).toBe(false)
    expect(cleanCollection({ name: 'A', kind: 'automatic', parentId: id(9), inheritParent: true }).fields.inheritParent).toBe(true)
    expect(refused(() => cleanCollection({ name: ' ', kind: 'manual' }))).toBe('NAME_REQUIRED')
    expect(refused(() => cleanCollection({ name: 'A', kind: 'smart' }))).toBe('INVALID_INPUT')
    expect(refused(() => cleanCollection({ name: 'A', kind: 'automatic', rules: Array.from({ length: 21 }, () => ({ kind: 'name_contains', text: 'x' })) }))).toBe('TOO_MANY_RULES')
    expect(refused(() => cleanCollection({ name: 'A', kind: 'manual', parentId: 'nope' }))).toBe('INVALID_PARENT')
  })
})

describe('the menu before it is written', () => {
  it('links collections, shop pages and https addresses, one level deep', () => {
    const rows = cleanMenu([
      { label: 'Shop', kind: 'collection', collectionId: id(1), children: [{ label: 'Returns', kind: 'page', url: '/policies/refund' }] },
      { label: 'Blog', kind: 'url', url: 'https://blog.example.com' },
    ])
    expect(rows.map((r) => [r.label, r.kind, r.parent_id === null])).toEqual([['Shop', 'collection', true], ['Returns', 'page', false], ['Blog', 'url', true]])
    expect(rows[1]?.parent_id).toBe(rows[0]?.id)
  })

  it('refuses a deeper item, a bad link and too many items', () => {
    expect(refused(() => cleanMenu([{ label: 'A', kind: 'page', url: '/a', children: [{ label: 'B', kind: 'page', url: '/b', children: [{ label: 'C', kind: 'page', url: '/c' }] }] }]))).toBe('TOO_DEEP')
    for (const item of [{ label: 'x', kind: 'url', url: 'http://a.example' }, { label: 'x', kind: 'url', url: 'javascript:alert(1)' }, { label: 'x', kind: 'page', url: 'https://a.example' }, { label: 'x', kind: 'collection' }]) {
      expect(refused(() => cleanMenu([item]))).toBe('INVALID_LINK')
    }
    expect(refused(() => cleanMenu(Array.from({ length: 101 }, (_, i) => ({ label: `i${i}`, kind: 'page', url: '/a' }))))).toBe('TOO_MANY_ITEMS')
  })
})
