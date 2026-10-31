import { renderToString } from 'react-dom/server'
import { z } from 'zod'
import { describe, expect, it } from 'vitest'
import { Provided } from '../../../test/shop'
import type { RecordedAnswer } from '../api/recorded'
import { answeredRender } from './answered'
import { PrefilledProvider, useShopData } from './data'

// Card #1011: the live build renders each page from the recorded catalogue, asking each question once per build.

const Named = ({ slug, calls }: { slug: string; calls: string[] }) => {
  const product = useShopData(JSON.stringify(['product', slug]), (client) => {
    calls.push(slug)
    return client.query('query Product($slug: String!) { product(slug: $slug) { name } }', z.object({ product: z.object({ name: z.string() }) }), { slug })
  })
  return <p>{product.status === 'ready' ? product.data.product.name : product.status}</p>
}

const Cart = () => <p>{useShopData('cart', (client) => client.request('query Cart { cart { id } }')).status}</p>
const Broken = () => <p>{useShopData('broken', (client) => client.query('query Product($slug: String!) { product(slug: $slug) { name } }', z.object({ product: z.number() }), { slug: 'kurta' })).status}</p>

const page = (children: React.ReactNode) => (client: Parameters<Parameters<typeof answeredRender>[1]>[0], prefilled: Parameters<Parameters<typeof answeredRender>[1]>[1]) =>
  renderToString(
    <Provided mode="live" client={client}>
      <PrefilledProvider value={prefilled}>{children}</PrefilledProvider>
    </Provided>,
  )

describe('answeredRender', () => {
  it('renders a page from the recorded answers, keeping only the answers that page asked for', async () => {
    const recorded: RecordedAnswer[] = [
      { operation: 'Product', variables: { slug: 'kurta' }, data: { product: { name: 'Kurta' } } },
      { operation: 'Product', variables: { slug: 'shirt' }, data: { product: { name: 'Shirt' } } },
    ]
    const calls: string[] = []
    const first = await answeredRender(recorded, page(<Named slug="kurta" calls={calls} />))
    expect(first.html).toContain('Kurta')
    expect(first.answers).toEqual({ '["product","kurta"]': { product: { name: 'Kurta' } } })
    const second = await answeredRender(recorded, page(<Named slug="shirt" calls={calls} />))
    expect(Object.keys(second.answers)).toEqual(['["product","shirt"]'])
  })

  it('answers a question once per build, and asks one the snapshot can’t answer only once', async () => {
    const recorded: RecordedAnswer[] = [{ operation: 'Product', variables: { slug: 'kurta' }, data: { product: { name: 'Kurta' } } }]
    const calls: string[] = []
    const one = await answeredRender(recorded, page(<><Named slug="kurta" calls={calls} /><Cart /></>))
    const two = await answeredRender(recorded, page(<><Named slug="kurta" calls={calls} /><Cart /></>))
    expect(calls).toEqual(['kurta'])
    expect([one.html, two.html].every((h) => h.includes('Kurta') && h.includes('loading'))).toBe(true)
    expect([one.unexpected, two.unexpected]).toEqual([[], []])
    expect(two.answers).toEqual({ '["product","kurta"]': { product: { name: 'Kurta' } } })
  })

  it('names an answer core couldn’t use, and renders that part as still loading', async () => {
    const recorded: RecordedAnswer[] = [{ operation: 'Product', variables: { slug: 'kurta' }, data: { product: { name: 'Kurta' } } }]
    const rendered = await answeredRender(recorded, page(<Broken />))
    expect(rendered.unexpected).toEqual(['BAD_RESPONSE'])
    expect(rendered.html).toContain('loading')
  })
})
