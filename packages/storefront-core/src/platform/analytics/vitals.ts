import type { ConsentChoice } from '../consent/consent'

// Real-user Core Web Vitals (storefront ARCHITECTURE §9): measured on every page, sent first-party to the store's own Shop
// API only when the page is left and only if the shopper agreed to analytics. Nothing names the shopper or the address.

export type VitalsPage = 'home' | 'collection' | 'product' | 'custom' | 'cart' | 'checkout' | 'other'

export type VitalsReport = { page: VitalsPage; device: 'phone' | 'desktop'; lcp: number; inp: number; cls: number }

type Entry = { startTime: number; duration: number; value?: number; hadRecentInput?: boolean; interactionId?: number }

/** The browser around the reporter; tests pass their own. */
export type VitalsHooks = {
  observe: (type: 'largest-contentful-paint' | 'layout-shift' | 'event', take: (entries: readonly Entry[]) => void) => void
  onHidden: (done: () => void) => void
  send: (url: string, body: string) => void
  isPhone: () => boolean
}

export const vitalsEndpoint = '/shop-api/vitals'

const browserHooks = (): VitalsHooks => ({
  observe: (type, take) => {
    if (typeof PerformanceObserver === 'undefined' || !PerformanceObserver.supportedEntryTypes?.includes(type)) return
    const observer = new PerformanceObserver((list) => take(list.getEntries() as unknown as Entry[]))
    observer.observe({ type, buffered: true, ...(type === 'event' ? { durationThreshold: 40 } : {}) } as PerformanceObserverInit)
  },
  onHidden: (done) => {
    const once = () => {
      if (document.visibilityState === 'hidden') {
        document.removeEventListener('visibilitychange', once)
        done()
      }
    }
    document.addEventListener('visibilitychange', once)
  },
  send: (url, body) => {
    navigator.sendBeacon(url, new Blob([body], { type: 'text/plain' }))
  },
  isPhone: () => window.matchMedia('(max-width: 767px)').matches,
})

/** Starts measuring the page; on leaving it, sends one report if the shopper has agreed to analytics by then. */
export const reportVitals = (options: { page: VitalsPage; consent: () => ConsentChoice | null; hooks?: VitalsHooks }): void => {
  const hooks = options.hooks ?? browserHooks()
  let lcp = 0
  let cls = 0
  let session = { sum: 0, first: 0, last: 0 }
  const interactions = new Map<number, number>()
  hooks.observe('largest-contentful-paint', (entries) => {
    for (const e of entries) lcp = Math.max(lcp, e.startTime)
  })
  // CLS: the largest session window, shifts under a second apart and five at most (web.dev/cls).
  hooks.observe('layout-shift', (entries) => {
    for (const e of entries) {
      if (e.hadRecentInput) continue
      const joins = session.sum > 0 && e.startTime - session.last < 1000 && e.startTime - session.first < 5000
      session = joins ? { sum: session.sum + (e.value ?? 0), first: session.first, last: e.startTime } : { sum: e.value ?? 0, first: e.startTime, last: e.startTime }
      cls = Math.max(cls, session.sum)
    }
  })
  hooks.observe('event', (entries) => {
    for (const e of entries) if (e.interactionId) interactions.set(e.interactionId, Math.max(interactions.get(e.interactionId) ?? 0, e.duration))
  })
  hooks.onHidden(() => {
    if (options.consent()?.analytics !== true || lcp === 0) return
    // INP: the slowest interaction, one in fifty set aside as an outlier (web.dev/inp).
    const slowest = [...interactions.values()].sort((a, b) => b - a)
    const inp = slowest[Math.min(slowest.length - 1, Math.floor(slowest.length / 50))] ?? 0
    const report: VitalsReport = { page: options.page, device: hooks.isPhone() ? 'phone' : 'desktop', lcp: Math.round(lcp), inp: Math.round(inp), cls: Math.round(cls * 1000) / 1000 }
    hooks.send(vitalsEndpoint, JSON.stringify(report))
  })
}
