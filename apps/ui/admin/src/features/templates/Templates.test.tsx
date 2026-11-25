import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import { renderToString } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { ApiError } from '@dripfunnel/shared/graphql'
import { collectionKeyOf, collectionsOf, type StorefrontTemplate } from '../../api/templates'
import { messages } from '../../messages'
import { textOf } from '../../testing/textOf'
import { TemplateCollections, TemplateCollectionView, type TemplateCollectionProps } from './Templates'
import { previewRefusalText } from './TemplatesScreen'

const words = messages.templates
const noop = () => undefined

const templateOf = (over: Partial<StorefrontTemplate> = {}): StorefrontTemplate => ({
  key: 'fashion',
  name: 'Thread',
  tag: 'Fashion & apparel',
  description: 'Clean editorial layout.',
  state: 'offered',
  categories: [{ id: 'c1', key: 'fashion_apparel', names: [{ language: 'en', name: 'Fashion & apparel' }] }],
  storeCount: 2,
  demo: 'ready',
  ...over,
})
const grocery = [
  templateOf({ key: 'grocery', name: 'Basket', tag: 'Food & grocery', categories: [{ id: 'c2', key: 'food_grocery', names: [{ language: 'en', name: 'Food & Grocery' }] }], storeCount: 1 }),
  templateOf({ key: 'market', name: 'Market', tag: 'Food & grocery', categories: [], demo: 'none', storeCount: 0 }),
]
const all = [templateOf(), ...grocery]

const render = async (node: ReactNode) => {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ['/templates'] }) })
  await router.load()
  return renderToString(<RouterProvider router={router} />)
}

const collection = (props: Partial<TemplateCollectionProps> = {}) =>
  render(<TemplateCollectionView collection={collectionsOf(grocery)[0] ?? null} forced={null} canMake={false} opening={null} onPreview={noop} onReload={noop} {...props} />)

describe('template collections', () => {
  it('groups templates by tag, in the order the API lists them', () => {
    expect(collectionsOf(all).map((c) => [c.key, c.name, c.templates.map((t) => t.key)])).toEqual([
      ['fashion-apparel', 'Fashion & apparel', ['fashion']],
      ['food-grocery', 'Food & grocery', ['grocery', 'market']],
    ])
    expect(collectionKeyOf('Traditional & ethnic')).toBe('traditional-ethnic')
  })

  it('shows a card per collection with its templates, linked to it', async () => {
    const html = await render(<TemplateCollections collections={collectionsOf(all)} forced={null} onReload={noop} />)
    expect(html).toContain('href="/templates/food-grocery"')
    expect(textOf(html)).toContain('Food & grocery')
    expect(textOf(html)).toContain('Basket, Market')
    expect(textOf(html)).toContain('2 templates')
    expect(textOf(html)).toContain('1 template')
  })

  it('draws the forced states', async () => {
    expect(textOf(await render(<TemplateCollections collections={[]} forced={null} onReload={noop} />))).toContain(words.empty.title)
    expect(textOf(await render(<TemplateCollections collections={collectionsOf(all)} forced="error" onReload={noop} />))).toContain(words.error.title)
  })
})

describe('one collection', () => {
  it('lists its templates with their categories, stores and Preview', async () => {
    const html = await collection()
    const text = textOf(html)
    expect(text).toContain('Basket')
    expect(text).toContain('Food & Grocery')
    expect(text).toContain('1 store')
    expect(html).toContain(`aria-label="${words.preview}: Basket"`)
    expect(html).not.toContain(`aria-label="${words.preview}: Market"`)
    expect(text).toContain(words.demo.none)
    expect(html).toContain('href="/templates"')
  })

  it.each([
    ['none', words.demo.noDemo],
    ['creating', words.demo.creating],
  ] as const)('says when the demo store is %s, to a role that can’t set it up', async (demo, text) => {
    const html = await collection({ collection: { key: 'food-grocery', name: 'Food & grocery', templates: [templateOf({ demo })] } })
    expect(textOf(html)).toContain(text)
    expect(html).not.toContain(`aria-label="${words.preview}: Thread"`)
  })

  it('offers a Super admin Preview before the demo exists, which sets it up', async () => {
    const html = await collection({ collection: { key: 'fashion-apparel', name: 'Fashion & apparel', templates: [templateOf({ demo: 'none' })] }, canMake: true })
    expect(html).toContain(`aria-label="${words.preview}: Thread"`)
  })

  it('waits on the template whose link is being made', async () => {
    expect(textOf(await collection({ opening: 'grocery' }))).toContain(words.opening)
  })

  it('says when no template has the address', async () => {
    expect(textOf(await collection({ collection: null }))).toContain(words.missing.title)
  })

  it('words a refused preview', () => {
    expect(previewRefusalText(new ApiError('NO_DEMO', 'x'))).toBe(words.refusals.NO_DEMO)
    expect(previewRefusalText(new Error('x'))).toBe(words.refusals.other)
  })
})
