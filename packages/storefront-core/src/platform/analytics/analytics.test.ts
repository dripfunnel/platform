import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConsentChoice } from '../consent/consent'
import { createAnalytics, ga4, metaPixel, type AnalyticsProvider, type CommerceEvent } from './analytics'

const provider = (kind: AnalyticsProvider['kind']) => ({ kind, load: vi.fn(), send: vi.fn() })
const event: CommerceEvent = { name: 'begin_checkout', value: { amount: '1200', currency: 'USD' } }
const both: ConsentChoice = { analytics: true, marketing: true, at: '2026-10-08T00:00:00Z' }

type Globals = { dataLayer?: unknown[]; gtag?: unknown; fbq?: { queue: unknown[] }; _fbq?: unknown }
const g = globalThis as unknown as Globals
const isArguments = (v: unknown) => Object.prototype.toString.call(v) === '[object Arguments]'

afterEach(() => {
  delete g.dataLayer
  delete g.gtag
  delete g.fbq
  delete g._fbq
})

describe('createAnalytics', () => {
  it('sends nothing, and loads nothing, before the shopper chooses', () => {
    const p = provider('analytics')
    createAnalytics([p], () => null).track(event)
    expect(p.load).not.toHaveBeenCalled()
    expect(p.send).not.toHaveBeenCalled()
  })

  it('loads each provider once, and only the kinds agreed to', () => {
    const a = provider('analytics')
    const m = provider('marketing')
    const choice: ConsentChoice = { analytics: true, marketing: false, at: '2026-10-08T00:00:00Z' }
    const analytics = createAnalytics([a, m], () => choice)
    analytics.track(event)
    analytics.track(event)
    expect(a.load).toHaveBeenCalledTimes(1)
    expect(a.send).toHaveBeenCalledTimes(2)
    expect(m.load).not.toHaveBeenCalled()
  })

  it('stops sending as soon as the shopper withdraws', () => {
    const a = provider('analytics')
    let choice: ConsentChoice = both
    const analytics = createAnalytics([a], () => choice)
    analytics.track(event)
    choice = { ...both, analytics: false }
    analytics.track(event)
    expect(a.send).toHaveBeenCalledTimes(1)
  })
})

describe('ga4', () => {
  it('pushes Arguments objects, which is all gtag.js reads, with a major-unit value', () => {
    const p = ga4('G-TEST')
    p.load()
    p.send({ name: 'purchase', orderId: 'o_1', value: { amount: '1999', currency: 'USD' } })
    const layer = g.dataLayer ?? []
    expect(layer.every(isArguments)).toBe(true)
    expect(layer.map((e) => Array.from(e as ArrayLike<unknown>)[0])).toEqual(['js', 'config', 'event'])
    expect(Array.from(layer[2] as ArrayLike<unknown>)).toEqual(['event', 'purchase', { currency: 'USD', value: 19.99, transaction_id: 'o_1' }])
  })

  it('sends item_id, and reads JPY without decimals', () => {
    const p = ga4('G-TEST')
    p.send({ name: 'add_to_cart', itemId: 'v_1', quantity: 2, value: { amount: '1200', currency: 'JPY' } })
    expect(Array.from((g.dataLayer ?? [])[0] as ArrayLike<unknown>)[2]).toEqual({ currency: 'JPY', value: 1200, items: [{ item_id: 'v_1', quantity: 2 }] })
  })
})

describe('metaPixel', () => {
  it("queues init and events on Meta's own stub until fbevents.js loads", () => {
    const p = metaPixel('123')
    p.load()
    p.send({ name: 'view_item', itemId: 'v_1', value: { amount: '2800', currency: 'INR' } })
    expect(g.fbq?.queue).toEqual([
      ['init', '123'],
      ['track', 'ViewContent', { value: 28, currency: 'INR', content_ids: ['v_1'], content_type: 'product' }],
    ])
  })
})
