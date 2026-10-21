import { describe, expect, it } from 'vitest'
import type { TranslationRow } from '../../api/translations'
import { todoCount, translationInputOf } from './TranslationView'

const row = (r: Partial<TranslationRow> & Pick<TranslationRow, 'entity' | 'entityId' | 'field'>): TranslationRow => ({ main: 'Main', text: null, status: 'missing', ...r })

const rows: TranslationRow[] = [
  row({ entity: 'product', entityId: 'p1', field: 'name', main: 'Linen shirt', text: 'Linen kameez', status: 'translated' }),
  row({ entity: 'product', entityId: 'p1', field: 'description', main: 'Soft' }),
  row({ entity: 'version', entityId: 'v1', field: 'name', main: 'Red', status: 'changed', text: 'Laal' }),
  row({ entity: 'choice_name', entityId: 'red', field: 'name', main: 'Red' }),
  row({ entity: 'product', entityId: 'p1', field: 'slug', main: '' }),
]

describe('a product’s translation', () => {
  it('sends only the fields typed differently, an emptied one as a clear', () => {
    const typed = { 'product|p1|name': 'Linen kameez', 'product|p1|description': ' Mulayam ', 'version|v1|name': '', 'choice_name|red|name': 'Laal' }
    expect(translationInputOf(rows, typed, false)).toEqual({ description: 'Mulayam', versions: [{ id: 'v1', name: '' }], names: [{ kind: 'choice_name', source: 'red', text: 'Laal' }] })
    expect(translationInputOf(rows, {}, false)).toEqual({})
  })

  it('never sends the catalogue’s choice names from a supplier', () => {
    expect(translationInputOf(rows, { 'choice_name|red|name': 'Laal' }, true)).toEqual({})
  })

  it('counts what is left: missing or changed since, never an empty main text', () => {
    expect(todoCount(rows)).toBe(3)
  })
})
