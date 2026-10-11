import { describe, expect, it } from 'vitest'
import type { ConsentChoice } from '../consent/consent'
import { reportVitals, vitalsEndpoint, type VitalsHooks } from './vitals'

const fake = () => {
  const observers = new Map<string, (entries: { startTime: number; duration: number; value?: number; hadRecentInput?: boolean; interactionId?: number }[]) => void>()
  const sent: { url: string; body: unknown }[] = []
  let leave = (): void => undefined
  const hooks: VitalsHooks = {
    observe: (type, take) => void observers.set(type, take),
    onHidden: (done) => void (leave = done),
    send: (url, body) => void sent.push({ url, body: JSON.parse(body) }),
    isPhone: () => true,
  }
  return { hooks, sent, emit: (type: string, entries: Parameters<NonNullable<ReturnType<typeof observers.get>>>[0]) => observers.get(type)?.(entries), leave: () => leave() }
}
const agreed: ConsentChoice = { analytics: true, marketing: false, at: '2026-10-11T00:00:00Z' }

describe('reportVitals', () => {
  it('sends nothing for a shopper who hasn’t agreed to analytics, or has refused it', () => {
    for (const consent of [null, { ...agreed, analytics: false }]) {
      const page = fake()
      reportVitals({ page: 'product', consent: () => consent, hooks: page.hooks })
      page.emit('largest-contentful-paint', [{ startTime: 1200, duration: 0 }])
      page.leave()
      expect(page.sent).toEqual([])
    }
  })

  it('sends one report on leaving, first-party, with the page kind and device and nothing that names the shopper', () => {
    const page = fake()
    reportVitals({ page: 'product', consent: () => agreed, hooks: page.hooks })
    page.emit('largest-contentful-paint', [{ startTime: 900, duration: 0 }, { startTime: 1800, duration: 0 }])
    page.emit('layout-shift', [{ startTime: 100, duration: 0, value: 0.05 }, { startTime: 600, duration: 0, value: 0.04 }, { startTime: 3000, duration: 0, value: 0.2, hadRecentInput: true }])
    page.emit('event', [{ startTime: 10, duration: 80, interactionId: 1 }, { startTime: 20, duration: 120, interactionId: 1 }, { startTime: 30, duration: 300, interactionId: 2 }])
    page.leave()
    expect(page.sent).toEqual([{ url: vitalsEndpoint, body: { page: 'product', device: 'phone', lcp: 1800, inp: 300, cls: 0.09 } }])
  })

  it('takes the consent given during the visit, and sends nothing without a paint', () => {
    let consent: ConsentChoice | null = null
    const page = fake()
    reportVitals({ page: 'home', consent: () => consent, hooks: page.hooks })
    page.emit('largest-contentful-paint', [{ startTime: 700, duration: 0 }])
    consent = agreed
    page.leave()
    expect(page.sent).toHaveLength(1)
    const blank = fake()
    reportVitals({ page: 'home', consent: () => agreed, hooks: blank.hooks })
    blank.leave()
    expect(blank.sent).toEqual([])
  })
})
