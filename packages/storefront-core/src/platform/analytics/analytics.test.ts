import { afterEach, describe, expect, it, vi } from 'vitest'
import { moneySchema } from '../../pricing/money'
import type { ConsentChoice } from '../consent/consent'
import { analyticsScriptUrl, createAnalytics, ga4, googleTagManager, metaPixel, type AnalyticsProvider, type CommerceEvent } from './analytics'

const provider = (...needs: AnalyticsProvider['needs']) => ({ needs, load: vi.fn(), send: vi.fn(), setConsent: vi.fn() })
const event: CommerceEvent = { name: 'begin_checkout', value: moneySchema.parse({ amount: '1200', currency: 'USD' }) }
const both: ConsentChoice = { analytics: true, marketing: true, at: '2026-10-08T00:00:00Z' }

type Globals = { dataLayer?: unknown[]; gtag?: unknown; fbq?: { queue: unknown[] }; _fbq?: unknown; dfConsentDefault?: boolean }
const g = globalThis as unknown as Globals
const isArguments = (v: unknown) => Object.prototype.toString.call(v) === '[object Arguments]'

afterEach(() => {
  delete g.dataLayer
  delete g.gtag
  delete g.fbq
  delete g._fbq
  delete g.dfConsentDefault
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

  it('loads Google Tag Manager only with both kinds, since its container may hold marketing tags', () => {
    expect(googleTagManager('GTM-X').needs).toEqual(['analytics', 'marketing'])
    const gtm = provider('analytics', 'marketing')
    createAnalytics([gtm], () => ({ ...both, marketing: false })).track(event)
    expect(gtm.load).not.toHaveBeenCalled()
  })

  it('stops sending as soon as the shopper withdraws', () => {
    const a = provider('analytics')
    let choice: ConsentChoice = both
    const analytics = createAnalytics([a], () => choice)
    analytics.track(event)
    choice = { ...both, analytics: false }
    analytics.consentChanged()
    analytics.track(event)
    expect(a.send).toHaveBeenCalledTimes(1)
    expect(a.setConsent).toHaveBeenCalledWith(expect.objectContaining({ analytics: false, marketing: true }))
  })
})

describe('ga4', () => {
  it('pushes Arguments objects, which is all gtag.js reads, with a major-unit value', () => {
    const p = ga4('G-TEST')
    p.load({ analytics: true, marketing: false })
    p.send({ name: 'purchase', orderId: 'o_1', value: moneySchema.parse({ amount: '1999', currency: 'USD' }) })
    const layer = g.dataLayer ?? []
    expect(layer.every(isArguments)).toBe(true)
    expect(layer.map((e) => Array.from(e as ArrayLike<unknown>)[0])).toEqual(['consent', 'consent', 'js', 'config', 'event'])
    expect(Array.from(layer[0] as ArrayLike<unknown>)).toEqual(['consent', 'default', expect.objectContaining({ analytics_storage: 'denied', ad_storage: 'denied' })])
    expect(Array.from(layer[1] as ArrayLike<unknown>)).toEqual(['consent', 'update', expect.objectContaining({ analytics_storage: 'granted', ad_storage: 'denied' })])
    expect(Array.from(layer[4] as ArrayLike<unknown>)).toEqual(['event', 'purchase', { currency: 'USD', value: 19.99, transaction_id: 'o_1' }])
    p.setConsent({ analytics: false, marketing: false })
    expect(Array.from(layer[5] as ArrayLike<unknown>)).toEqual(['consent', 'update', expect.objectContaining({ analytics_storage: 'denied' })])
  })

  it('sends item_id, and reads JPY without decimals', () => {
    const p = ga4('G-TEST')
    p.send({ name: 'add_to_cart', itemId: 'v_1', quantity: 2, value: moneySchema.parse({ amount: '1200', currency: 'JPY' }) })
    expect(Array.from((g.dataLayer ?? [])[0] as ArrayLike<unknown>)[2]).toEqual({ currency: 'JPY', value: 1200, items: [{ item_id: 'v_1', quantity: 2 }] })
  })
})

describe('googleTagManager', () => {
  it('passes "accept all" to the container as granted ad signals, after a single denied default', () => {
    ga4('G-TEST').load({ analytics: true, marketing: true })
    googleTagManager('GTM-X').load({ analytics: true, marketing: true })
    const consent = (g.dataLayer ?? []).filter((e) => Array.from(e as ArrayLike<unknown>)[0] === 'consent').map((e) => Array.from(e as ArrayLike<unknown>).slice(1))
    expect(consent.filter(([kind]) => kind === 'default')).toHaveLength(1)
    expect(consent.at(-1)).toEqual(['update', { analytics_storage: 'granted', ad_storage: 'granted', ad_user_data: 'granted', ad_personalization: 'granted' }])
  })
})

describe('metaPixel', () => {
  it("queues init and events on Meta's own stub until fbevents.js loads", () => {
    const p = metaPixel('123')
    p.load({ analytics: false, marketing: true })
    p.send({ name: 'view_item', itemId: 'v_1', value: moneySchema.parse({ amount: '2800', currency: 'INR' }) })
    expect(g.fbq?.queue).toEqual([
      ['init', '123'],
      ['track', 'ViewContent', { value: 28, currency: 'INR', content_ids: ['v_1'], content_type: 'product' }],
    ])
    p.setConsent({ analytics: true, marketing: false })
    expect(g.fbq?.queue.at(-1)).toEqual(['consent', 'revoke'])
  })
})

describe('analyticsScriptUrl', () => {
  it('refuses a foreign host or plain http', () => {
    expect(analyticsScriptUrl('https://connect.facebook.net/en_US/fbevents.js')).toBe('https://connect.facebook.net/en_US/fbevents.js')
    expect(() => analyticsScriptUrl('https://evil.example/x.js')).toThrow(/Not an analytics script URL/)
    expect(() => analyticsScriptUrl('http://www.googletagmanager.com/gtag/js')).toThrow(/Not an analytics script URL/)
  })

})
