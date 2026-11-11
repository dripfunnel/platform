// @vitest-environment happy-dom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Provided, shopAnswering } from '../../../test/shop'
import { useProduct } from '../../products/product'
import { ProductStory } from './productStory'

// A product's A+ content (#1351): every module kind decoded and drawn, in the merchant's order; nothing for a product without any.

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})
beforeEach(() => history.replaceState(null, '', '/products/tee/'))

const url = (name: string) => ({ url: `https://shop.example/shop-api/assets/${name}` })
const photo = (name: string, alt: string | null = `${name} alt`) => ({ alt, image: url(name) })
const usd = (amount: number) => ({ amount: String(amount), currency: 'USD' })
const card = (id: string, name: string, amount: number) => ({ id, name, slug: id, inStock: true, price: usd(amount), compareAt: null, maxPrice: null, photo: photo(id), badges: [] })

const base = {
  id: 'p1',
  name: 'Tee',
  slug: 'tee',
  description: null,
  highlights: [],
  inStock: true,
  price: usd(2800),
  compareAt: null,
  maxPrice: null,
  badges: [],
  photos: [],
  video: null,
  options: [],
  versions: [{ id: 'v1', name: null, choices: [], price: usd(2800), compareAt: null, inStock: true, available: 3 }],
  specs: [{ name: 'Fabric', value: 'Organic cotton', versionId: null }, { name: 'Colour', value: 'Sage', versionId: 'v-other' }],
  faqs: [{ question: 'Does it shrink?', answer: 'Not after the first wash.' }],
  compliance: [],
  returns: null,
  warranty: null,
  seoTitle: null,
  seoDescription: null,
  related: [],
}
const module = (fields: Record<string, unknown>) => ({ title: null, body: null, side: null, photo: null, photos: null, items: null, products: null, block: null, video: null, ...fields })

const every = [
  module({ id: 'm1', kind: 'banner', title: 'Made to be lived in', photo: photo('banner', 'A tee on a washing line') }),
  module({ id: 'm2', kind: 'imageText', title: 'The fabric', body: 'Heavyweight cotton.', side: 'right', photo: photo('fabric', 'Close-up of the cotton') }),
  module({ id: 'm3', kind: 'features', title: null, items: [{ title: 'Pre-washed', text: 'No shrinking.', photo: photo('wash', 'A wash tag') }, { title: 'Organic', text: null, photo: null }] }),
  module({ id: 'm4', kind: 'compare', title: 'Pick your tee', products: [card('a', 'Crew tee', 2800), card('b', 'Pocket tee', 3200)] }),
  module({ id: 'm5', kind: 'gallery', title: 'In the wild', photos: [photo('g1', 'On the beach'), photo('g2', 'In the park')] }),
  module({ id: 'm6', kind: 'box', title: null, items: [{ title: 'One tee', text: null, photo: null }, { title: 'A care card', text: null, photo: null }] }),
  module({ id: 'm7', kind: 'specs', title: null }),
  module({ id: 'm8', kind: 'brand', block: { title: 'Our story', body: 'Made slowly.', photo: photo('brand', 'The workshop') } }),
  module({ id: 'm9', kind: 'faq', title: null }),
  module({ id: 'm10', kind: 'video', title: 'See it move', video: { file: url('clip'), url: null } }),
]

const Page = ({ versionId }: { versionId?: string }) => {
  const { product } = useProduct()
  return (
    <>
      <h1>{product?.name ?? 'loading'}</h1>
      <ProductStory product={product} versionId={versionId ?? null} classes={{ root: 'story', module: 'mod', question: 'q' }} />
    </>
  )
}

const shown = async (story: unknown, versionId?: string) => {
  const asked = shopAnswering(() => ({ data: { product: { ...base, story, storyTemplate: null }, store: { marketId: 'm', markets: [] } } }))
  const view = render(<Provided><Page {...(versionId ? { versionId } : {})} /></Provided>)
  await vi.waitFor(() => expect(asked.length).toBeGreaterThan(0))
  return { asked, view }
}

describe('ProductStory', () => {
  it('asks the Shop API for the story and its template', async () => {
    const { asked } = await shown([])
    expect(asked[0]?.query).toContain('storyTemplate story { id kind title body side')
  })

  it('draws every module kind, in the merchant’s order, in a labelled section', async () => {
    await shown(every)
    const section = await screen.findByRole('region', { name: 'More about this product' })
    expect([...section.querySelectorAll('.mod')].map((m) => m.getAttribute('data-kind'))).toEqual(['banner', 'imageText', 'features', 'compare', 'gallery', 'box', 'specs', 'brand', 'faq', 'video'])
    expect(section.getAttribute('class')).toBe('story')
  })

  it('shows each module’s own words, and a default heading for a kind with no title', async () => {
    await shown(every)
    const section = await screen.findByRole('region', { name: 'More about this product' })
    const headings = within(section).getAllByRole('heading', { level: 2 }).map((h) => h.textContent)
    expect(headings).toEqual(['Made to be lived in', 'The fabric', 'Highlights', 'Pick your tee', 'In the wild', 'What’s in the box', 'Specifications', 'Our story', 'Questions', 'See it move'])
    expect(within(section).getByText('Heavyweight cotton.')).toBeTruthy()
    expect(within(section).getByText('Made slowly.')).toBeTruthy()
    expect(within(section).getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Pre-washed', 'Organic', 'Does it shrink?'])
    expect(within(section).getByText('No shrinking.')).toBeTruthy()
    expect(within(section).getByText('One tee')).toBeTruthy()
    expect(within(section).getByText('A care card')).toBeTruthy()
  })

  it('draws photos with their alt text, and the side an image-and-text module asks for', async () => {
    await shown(every)
    const section = await screen.findByRole('region', { name: 'More about this product' })
    expect(within(section).getAllByRole('img').map((i) => i.getAttribute('alt'))).toEqual(['A tee on a washing line', 'Close-up of the cotton', 'A wash tag', 'a alt', 'b alt', 'On the beach', 'In the park', 'The workshop'])
    expect(section.querySelector('[data-kind="imageText"]')?.getAttribute('data-side')).toBe('right')
  })

  it('compares products with their names, links and prices', async () => {
    await shown(every)
    const section = await screen.findByRole('region', { name: 'More about this product' })
    const links = within(section).getAllByRole('link').map((l) => [l.textContent, l.getAttribute('href')])
    expect(links).toEqual([['Crew tee', '/products/a/'], ['Pocket tee', '/products/b/']])
  })

  it('shows the product’s own specifications, with the chosen version’s, and its questions', async () => {
    await shown(every)
    const section = await screen.findByRole('region', { name: 'More about this product' })
    const terms = (s: HTMLElement) => [...s.querySelectorAll('dt')].map((t) => t.textContent)
    expect(terms(section)).toEqual(['Fabric'])
    cleanup()
    await shown(every, 'v-other')
    expect(terms(await screen.findByRole('region', { name: 'More about this product' }))).toEqual(['Fabric', 'Colour'])
  })

  it('opens and closes a question with its button, which tells the state', async () => {
    await shown(every)
    const button = await screen.findByRole('button', { name: 'Does it shrink?' })
    const answer = () => document.getElementById(button.getAttribute('aria-controls') ?? '')
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(answer()?.hasAttribute('hidden')).toBe(true)
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('true')
    expect(answer()?.hasAttribute('hidden')).toBe(false)
    expect(answer()?.textContent).toBe('Not after the first wash.')
    fireEvent.click(button)
    expect(button.getAttribute('aria-expanded')).toBe('false')
  })

  it('plays an uploaded video only on request: controls, no autoplay, nothing preloaded', async () => {
    await shown(every)
    const section = await screen.findByRole('region', { name: 'More about this product' })
    const video = section.querySelector('video')
    expect(video?.getAttribute('src')).toBe('https://shop.example/shop-api/assets/clip')
    expect(video?.hasAttribute('controls')).toBe(true)
    expect(video?.hasAttribute('autoplay')).toBe(false)
    expect(video?.getAttribute('preload')).toBe('none')
    expect(video?.getAttribute('aria-label')).toBe('See it move')
  })

  it('links to a video hosted elsewhere over https and never embeds it; any other address shows nothing', async () => {
    await shown([module({ id: 'v1', kind: 'video', title: 'Elsewhere', video: { file: null, url: 'https://www.youtube.com/watch?v=abc' } }), module({ id: 'v2', kind: 'video', video: { file: null, url: 'javascript:alert(1)' } })])
    const section = await screen.findByRole('region', { name: 'More about this product' })
    expect(section.querySelector('iframe, video')).toBeNull()
    expect(within(section).getAllByRole('link').map((l) => l.getAttribute('href'))).toEqual(['https://www.youtube.com/watch?v=abc'])
  })

  it('skips a kind it doesn’t know and a module with nothing to show, and keeps the rest', async () => {
    await shown([
      module({ id: 'x1', kind: 'hologram', title: 'From the future' }),
      module({ id: 'x2', kind: 'banner', title: 'No picture', photo: null }),
      module({ id: 'x3', kind: 'features', items: [] }),
      module({ id: 'x4', kind: 'compare', products: [card('a', 'Only one', 100)] }),
      { id: 'x5' },
      module({ id: 'x6', kind: 'imageText', title: 'Kept', body: 'Still here.', side: 'left', photo: photo('kept', 'Kept photo') }),
    ])
    const section = await screen.findByRole('region', { name: 'More about this product' })
    expect([...section.querySelectorAll('.mod')].map((m) => m.getAttribute('data-kind'))).toEqual(['imageText'])
    expect(screen.queryByText('From the future')).toBeNull()
  })

  it('has no section for a product with no modules, or with none the shopper can see', async () => {
    await shown([])
    await screen.findByRole('heading', { name: 'Tee' })
    expect(screen.queryByRole('region', { name: 'More about this product' })).toBeNull()
    cleanup()
    await shown([module({ id: 'x', kind: 'hologram' })])
    await screen.findByRole('heading', { name: 'Tee' })
    expect(screen.queryByRole('region', { name: 'More about this product' })).toBeNull()
  })

  it('has no section for a product that has no story field at all, as an older Shop API answers', async () => {
    shopAnswering(() => ({ data: { product: base, store: { marketId: 'm', markets: [] } } }))
    render(<Provided><Page /></Provided>)
    await screen.findByRole('heading', { name: 'Tee' })
    expect(screen.queryByRole('region')).toBeNull()
  })
})
