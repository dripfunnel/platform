import type { ConsentChoice } from '../consent/consent'
import { toDecimal, type ShopMoney } from '../pricing/money'

// Commerce events to the providers the store set up, each only after the shopper agreed to its
// kind (storefront ARCHITECTURE §2.1: GA4, Meta Pixel and Google Tag Manager, decided on #337).

/** `value` is the Shop API's money (minor units with its currency); the adapters convert it. */
export type CommerceEvent =
  | { name: 'view_item'; itemId: string; value: ShopMoney }
  | { name: 'add_to_cart'; itemId: string; quantity: number; value: ShopMoney }
  | { name: 'begin_checkout'; value: ShopMoney }
  | { name: 'purchase'; orderId: string; value: ShopMoney }

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

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue: unknown[]; push: Fbq; loaded: boolean; version: string }
type Layer = { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; fbq?: Fbq; _fbq?: Fbq }
const win = () => globalThis as unknown as Layer & { document?: Document }

const addScript = (src: string) => {
  const doc = win().document
  if (!doc) return
  const s = doc.createElement('script')
  s.async = true
  s.src = src
  doc.head.appendChild(s)
}

/** The GA4 ecommerce parameters both Google adapters send: a major-unit value, item_id, transaction_id. */
export const ga4Params = (e: CommerceEvent) => ({
  currency: e.value.currency,
  value: Number(toDecimal(e.value)),
  ...(e.name === 'purchase' ? { transaction_id: e.orderId } : {}),
  ...(e.name === 'view_item' || e.name === 'add_to_cart' ? { items: [{ item_id: e.itemId, quantity: e.name === 'add_to_cart' ? e.quantity : 1 }] } : {}),
})

// gtag.js reads only Arguments objects from dataLayer, never plain arrays, hence `arguments`.
const gtag = () => {
  const w = win()
  w.dataLayer = w.dataLayer ?? []
  const layer = w.dataLayer
  w.gtag =
    w.gtag ??
    function () {
      // eslint-disable-next-line prefer-rest-params -- gtag.js ignores anything but an Arguments object
      layer.push(arguments)
    }
  return w.gtag
}

export const ga4 = (measurementId: string): AnalyticsProvider => ({
  kind: 'analytics',
  load: () => {
    const g = gtag()
    g('js', new Date())
    g('config', measurementId)
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`)
  },
  send: (e) => gtag()('event', e.name, ga4Params(e)),
})

export const googleTagManager = (containerId: string): AnalyticsProvider => ({
  kind: 'analytics',
  load: () => {
    const w = win()
    w.dataLayer = w.dataLayer ?? []
    w.dataLayer.push({ 'gtm.start': Date.now(), event: 'gtm.js' })
    addScript(`https://www.googletagmanager.com/gtm.js?id=${encodeURIComponent(containerId)}`)
  },
  send: (e) => {
    const layer = win().dataLayer
    layer?.push({ ecommerce: null })
    layer?.push({ event: e.name, ecommerce: ga4Params(e) })
  },
})

const pixelName: Record<CommerceEvent['name'], string> = { view_item: 'ViewContent', add_to_cart: 'AddToCart', begin_checkout: 'InitiateCheckout', purchase: 'Purchase' }

// Meta's bootstrap stub: fbevents.js replays fbq.queue (with apply) and then sets callMethod.
const fbq = (): Fbq => {
  const w = win()
  if (!w.fbq) {
    const stub = function (...args: unknown[]) {
      if (stub.callMethod) stub.callMethod(...args)
      else stub.queue.push(args)
    } as Fbq
    stub.push = stub
    stub.loaded = true
    stub.version = '2.0'
    stub.queue = []
    w.fbq = stub
    w._fbq = stub
  }
  return w.fbq
}

export const metaPixel = (pixelId: string): AnalyticsProvider => ({
  kind: 'marketing',
  load: () => {
    fbq()('init', pixelId)
    addScript('https://connect.facebook.net/en_US/fbevents.js')
  },
  send: (e) =>
    fbq()('track', pixelName[e.name], {
      value: Number(toDecimal(e.value)),
      currency: e.value.currency,
      ...(e.name === 'view_item' || e.name === 'add_to_cart' ? { content_ids: [e.itemId], content_type: 'product' } : {}),
    }),
})
