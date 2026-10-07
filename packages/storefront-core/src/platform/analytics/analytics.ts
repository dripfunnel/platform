import type { ConsentChoice } from '../consent/consent'

// Commerce events to the providers the store set up, each only after the shopper agreed to its
// kind (storefront ARCHITECTURE §2.1: GA4, Meta Pixel and Google Tag Manager, decided on #337).

export type CommerceEvent =
  | { name: 'view_item'; itemId: string; value: string; currency: string }
  | { name: 'add_to_cart'; itemId: string; quantity: number; value: string; currency: string }
  | { name: 'begin_checkout'; value: string; currency: string }
  | { name: 'purchase'; orderId: string; value: string; currency: string }

export type AnalyticsProvider = {
  kind: 'analytics' | 'marketing'
  load: () => void
  send: (event: CommerceEvent) => void
}

/** Events sent before consent are dropped, not held: nothing about a visit leaves until the shopper agrees. */
export const createAnalytics = (providers: readonly AnalyticsProvider[], consent: () => ConsentChoice | null) => {
  const loaded = new Set<AnalyticsProvider>()
  const allowed = (p: AnalyticsProvider) => {
    const c = consent()
    return c !== null && c[p.kind]
  }
  return {
    track(event: CommerceEvent) {
      for (const p of providers) {
        if (!allowed(p)) continue
        if (!loaded.has(p)) {
          p.load()
          loaded.add(p)
        }
        p.send(event)
      }
    },
  }
}

type Layer = { dataLayer?: unknown[]; fbq?: (...args: unknown[]) => void }
const win = () => globalThis as unknown as Layer & { document?: Document }

const addScript = (src: string) => {
  const doc = win().document
  if (!doc) return
  const s = doc.createElement('script')
  s.async = true
  s.src = src
  doc.head.appendChild(s)
}

const ga4Name: Record<CommerceEvent['name'], string> = { view_item: 'view_item', add_to_cart: 'add_to_cart', begin_checkout: 'begin_checkout', purchase: 'purchase' }

export const ga4 = (measurementId: string): AnalyticsProvider => ({
  kind: 'analytics',
  load: () => {
    const w = win()
    w.dataLayer = w.dataLayer ?? []
    w.dataLayer.push(['js', new Date()], ['config', measurementId])
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`)
  },
  send: ({ name, ...params }) => win().dataLayer?.push(['event', ga4Name[name], params]),
})

export const googleTagManager = (containerId: string): AnalyticsProvider => ({
  kind: 'analytics',
  load: () => {
    const w = win()
    w.dataLayer = w.dataLayer ?? []
    w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
    addScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`)
  },
  send: (e) => win().dataLayer?.push({ ...e, event: e.name }),
})

const pixelName: Record<CommerceEvent['name'], string> = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' }

export const metaPixel = (pixelId: string): AnalyticsProvider => {
  const queue: unknown[][] = []
  return {
    kind: 'marketing',
    load: () => {
      const w = win()
      w.fbq = w.fbq ?? ((...args: unknown[]) => queue.push(args))
      w.fbq('init', pixelId)
      addScript('https://connect.facebook.net/en_US/fbevents.js')
    },
    send: (e) => win().fbq?.('track', pixelName[e.name], { value: e.value, currency: e.currency }),
  }
}
