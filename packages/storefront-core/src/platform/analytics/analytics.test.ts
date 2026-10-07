import { describe, expect, it, vi } from 'vitest'
import type { ConsentChoice } from '../consent/consent'
import { createAnalytics, type AnalyticsProvider } from './analytics'

const provider = (kind: AnalyticsProvider['kind']) => ({ kind, load: vi.fn(), send: vi.fn() })
const event = { name: 'begin_checkout', value: '12.00', currency: 'USD' } as const

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
})
