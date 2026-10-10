import type { ConsentChoice } from '../consent/consent'
import { toDecimal, type Money } from '../../pricing/money'

// Commerce events to the providers the store set up, each only after the shopper agreed to its
// kind (storefront ARCHITECTURE §2.1: GA4, Meta Pixel and Google Tag Manager, decided on #337).

/** `value` is the Shop API's money (minor units with its currency); the adapters convert it. */
export type CommerceEvent =
  | { name: 'view_item'; itemId: string; value: Money }
  | { name: 'add_to_cart'; itemId: string; quantity: number; value: Money }
  | { name: 'begin_checkout'; value: Money }
  | { name: 'purchase'; orderId: string; value: Money }

type ConsentKind = 'analytics' | 'marketing'
type Consent = Record<ConsentKind, boolean>
const nothingAllowed: Consent = { analytics: false, marketing: false }

export type AnalyticsProvider = {
  /** Every kind the shopper must allow before it loads; a GTM container may hold any tag, so it needs both. */
  needs: readonly ConsentKind[]
  load: (consent: Consent) => void
  send: (event: CommerceEvent) => void
  /** Tells a loaded provider's own script what the shopper now allows, not just core's events. */
  setConsent: (consent: Consent) => void
}

/** Events sent before consent are dropped, not held: nothing about a visit leaves until the shopper agrees. */
export const createAnalytics = (providers: readonly AnalyticsProvider[], consent: () => ConsentChoice | null) => {
  const loaded = new Set<AnalyticsProvider>()
  const allowed = (p: AnalyticsProvider) => {
    const c = consent()
    return c !== null && p.needs.every((k) => c[k])
  }
  return {
    track(event: CommerceEvent) {
      for (const p of providers) {
        if (!allowed(p)) continue
        if (!loaded.has(p)) {
          p.load(consent() ?? nothingAllowed)
          loaded.add(p)
        }
        p.send(event)
      }
    },
    /** Call whenever the shopper's choice changes (ConsentBanner's onChange). */
    consentChanged() {
      const c = consent() ?? nothingAllowed
      for (const p of loaded) p.setConsent(c)
    },
  }
}

type Fbq = ((...args: unknown[]) => void) & { callMethod?: (...args: unknown[]) => void; queue: unknown[]; push: Fbq; loaded: boolean; version: string }
type Layer = { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void; fbq?: Fbq; _fbq?: Fbq; dfConsentDefault?: boolean }
const win = () => globalThis as unknown as Layer & { document?: Document }

const analyticsHosts = ['www.googletagmanager.com', 'connect.facebook.net']

/** A script URL core may load: https, on an analytics host (the Trusted Types policy around it is #481's). */
export const analyticsScriptUrl = (src: string): string => {
  const url = new URL(src)
  if (url.protocol !== 'https:' || !analyticsHosts.includes(url.host)) throw new Error(`Not an analytics script URL: ${src}`)
  return url.href
}

const addScript = (src: string) => {
  const doc = win().document
  if (!doc) return
  const s = doc.createElement('script')
  s.async = true
  s.src = analyticsScriptUrl(src)
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

// Google Consent Mode: analytics storage follows the analytics choice and the ad signals the
// marketing one; the denied default is sent once, before either Google script, whichever loads first.
const googleConsent = (c: Consent) => {
  const ads = c.marketing ? 'granted' : 'denied'
  return { analytics_storage: c.analytics ? 'granted' : 'denied', ad_storage: ads, ad_user_data: ads, ad_personalization: ads }
}

const startGoogleConsent = (c: Consent) => {
  const g = gtag()
  const w = win()
  if (!w.dfConsentDefault) {
    g('consent', 'default', googleConsent(nothingAllowed))
    w.dfConsentDefault = true
  }
  g('consent', 'update', googleConsent(c))
  return g
}

export const ga4 = (measurementId: string): AnalyticsProvider => ({
  needs: ['analytics'],
  load: (consent) => {
    const g = startGoogleConsent(consent)
    g('js', new Date())
    g('config', measurementId)
    addScript(`https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`)
  },
  send: (e) => gtag()('event', e.name, ga4Params(e)),
  setConsent: (consent) => gtag()('consent', 'update', googleConsent(consent)),
})

export const googleTagManager = (containerId: string): AnalyticsProvider => ({
  needs: ['analytics', 'marketing'],
  load: (consent) => {
    startGoogleConsent(consent)
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
  setConsent: (consent) => gtag()('consent', 'update', googleConsent(consent)),
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
  needs: ['marketing'],
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
  setConsent: (consent) => fbq()('consent', consent.marketing ? 'grant' : 'revoke'),
})
