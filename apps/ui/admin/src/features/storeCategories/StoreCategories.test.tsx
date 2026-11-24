import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@dripfunnel/shared/graphql'
import type { StoreCategory } from '../../api/storeCategories'
import { formatDate, messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { emptyForm, formOf, formProblem, inputOf } from './categoryForm'
import { CategoryFields } from './CategoryFields'
import { sampleText, StoreCategories, type StoreCategoriesProps } from './StoreCategories'
import { categoryDialog, refusalText } from './StoreCategoriesScreen'

const words = messages.storeCategories
const noop = () => undefined

const categoryOf = (over: Partial<StoreCategory> = {}): StoreCategory => ({
  id: 'c1',
  key: 'footwear',
  names: [{ language: 'en', name: 'Footwear' }, { language: 'hi', name: 'जूते' }],
  sections: ['sizeCharts', 'specs'],
  archivedAt: null,
  storeCount: 3,
  hasDefaultSample: false,
  template: null,
  sample: null,
  ...over,
})

const render = async (node: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ['/categories'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const list = (props: Partial<StoreCategoriesProps> = {}) =>
  render(
    <StoreCategories
      categories={[categoryOf({ id: 'old', key: 'vintage', names: [{ language: 'en', name: 'Vintage' }], sections: [], archivedAt: '2026-11-01T00:00:00Z', storeCount: 1 }), categoryOf()]}
      forced={null}
      canManage
      onAdd={noop}
      onAction={noop}
      onReload={noop}
      {...props}
    />,
  )

describe('Store categories', () => {
  it('lists each category with its key, sections and store count, archived ones last', async () => {
    const text = textOf(await list())
    expect(text).toContain('Footwear')
    expect(text).toContain('footwear')
    expect(text).toContain(words.sections.sizeCharts)
    expect(text).toContain('3 stores')
    expect(text).toContain(words.noSections)
    expect(text.indexOf('Footwear')).toBeLessThan(text.indexOf('Vintage'))
    expect(text).toContain(words.archived)
  })

  it('names the starting template, linked to Templates, or None', async () => {
    const html = await list({ categories: [categoryOf({ template: { key: 'fashion', name: 'Thread', tag: 'Fashion & apparel' } }), categoryOf({ id: 'c2', key: 'books' })] })
    expect(html).toContain('href="/templates/fashion-apparel#fashion"')
    expect(textOf(html)).toContain('Thread')
    expect(textOf(html)).toContain(words.noTemplate)
  })

  it('offers Add, Edit, Archive and Restore to a Super admin only', async () => {
    const text = textOf(await list())
    for (const word of [words.add, words.edit, words.archive, words.restore]) expect(text).toContain(word)
    const readOnly = await list({ canManage: false })
    expect(readOnly).not.toContain('<button')
    expect(textOf(readOnly)).toContain(words.readOnly.title)
  })

  it('states each category’s sample, or that it has none', () => {
    expect(sampleText(null)).toBe(words.sample.none)
    expect(sampleText({ currency: 'AED', products: 6, collections: [{ name: 'A', products: 3 }, { name: 'B', products: 3 }], photos: 6, uploadedAt: '2026-11-16T00:00:00.000Z' })).toBe(`Sample: 6 products · 2 collections · AED · added ${formatDate('2026-11-16T00:00:00.000Z')}`)
  })

  it('renders the harness states', async () => {
    expect(textOf(await list({ forced: 'empty' }))).toContain(words.empty.title)
    expect(textOf(await list({ forced: 'error' }))).toContain(words.error.title)
    expect(await list({ forced: 'readonly' })).not.toContain('<button')
    expect(await list({ forced: 'loading' })).toContain('df-skeleton')
  })

  it('states how many stores keep an archived category', () => {
    expect(categoryDialog({ kind: 'archive', category: categoryOf() }).consequence).toBe('3 stores keep this category; it leaves the picker for every other store.')
    expect(categoryDialog({ kind: 'archive', category: categoryOf({ storeCount: 1 }) }).consequence).toContain('1 store keep')
    expect(categoryDialog({ kind: 'archive', category: categoryOf() }).danger).toBe(true)
    expect(categoryDialog({ kind: 'add' }).form).toBe(true)
  })

  it('words each refusal, and any other failure', () => {
    expect(refusalText(new ApiError('KEY_TAKEN', 'x'))).toBe(words.refusals.KEY_TAKEN)
    expect(refusalText(new Error('boom'))).toBe(words.refusals.other)
  })
})

describe('the category form', () => {
  it('needs an English name, valid unique language codes, and names of 60 characters at most', () => {
    expect(formProblem(emptyForm)).toBe(words.form.englishMissing)
    expect(formProblem({ ...emptyForm, english: 'Shoes' })).toBeNull()
    expect(formProblem({ ...emptyForm, english: 'x'.repeat(61) })).toBe(words.form.tooLong)
    expect(formProblem({ ...emptyForm, english: 'Shoes', translations: [{ language: 'Hindi', name: 'जूते' }] })).toBe(words.form.badLanguage)
    expect(formProblem({ ...emptyForm, english: 'Shoes', translations: [{ language: 'hi', name: 'a' }, { language: 'hi', name: 'b' }] })).toBe(words.form.badLanguage)
    expect(formProblem({ ...emptyForm, english: 'Shoes', translations: [{ language: 'en', name: 'b' }] })).toBe(words.form.badLanguage)
  })

  it('round-trips a category into the API’s input, English first, sections in their fixed order', () => {
    const form = formOf(categoryOf({ sections: ['specs', 'sizeCharts'] }))
    expect(form).toEqual({ english: 'Footwear', translations: [{ language: 'hi', name: 'जूते' }], sections: ['sizeCharts', 'specs'] })
    expect(inputOf({ ...form, english: ' Shoes ' })).toEqual({ names: [{ language: 'en', name: 'Shoes' }, { language: 'hi', name: 'जूते' }], sections: ['sizeCharts', 'specs'] })
  })

  it('labels every field and section', async () => {
    const text = textOf(await render(<CategoryFields value={formOf(categoryOf())} onChange={noop} />))
    expect(text).toContain(words.form.english)
    expect(text).toContain(words.form.addTranslation)
    for (const label of Object.values(words.sections)) expect(text).toContain(label)
  })
})
