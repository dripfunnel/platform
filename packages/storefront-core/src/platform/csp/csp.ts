import { z } from 'zod'

// The CSP of storefront ARCHITECTURE §3.5: built per store from hashes, never a nonce, written into the
// build's manifest and sent as headers by the edge Worker (LIVE-SHOP §4 step 8, §5 step 5; PREVIEW §5 step 4).

type Hosts = { script?: string[]; connect?: string[]; img?: string[]; frame?: string[]; form?: string[] }

const google: Hosts = {
  script: ['https://www.googletagmanager.com'],
  connect: ['https://*.google-analytics.com', 'https://*.analytics.google.com', 'https://www.googletagmanager.com'],
  img: ['https://*.google-analytics.com', 'https://www.googletagmanager.com'],
}

/** Each analytics provider's hosts (§2.1), allowed only for a store that set it up. */
const analyticsProviders = ['ga4', 'gtm', 'meta'] as const
const paymentProviders = ['stripe', 'razorpay', 'cashfree', 'paypal', 'phonepe'] as const

const analyticsHosts: Record<(typeof analyticsProviders)[number], Hosts> = {
  ga4: google,
  gtm: google,
  meta: { script: ['https://connect.facebook.net'], connect: ['https://connect.facebook.net', 'https://www.facebook.com'], img: ['https://www.facebook.com'] },
}

/** Each payment provider's hosts *(proposed: #313 confirms them with each provider's adapter)*. */
const paymentHosts: Record<(typeof paymentProviders)[number], Hosts> = {
  stripe: { script: ['https://js.stripe.com'], connect: ['https://api.stripe.com'], frame: ['https://js.stripe.com', 'https://hooks.stripe.com'], form: ['https://hooks.stripe.com'] },
  razorpay: { script: ['https://checkout.razorpay.com'], connect: ['https://api.razorpay.com', 'https://lumberjack.razorpay.com'], frame: ['https://api.razorpay.com', 'https://checkout.razorpay.com'], img: ['https://cdn.razorpay.com'], form: ['https://api.razorpay.com'] },
  cashfree: { script: ['https://sdk.cashfree.com'], connect: ['https://api.cashfree.com', 'https://sandbox.cashfree.com'], frame: ['https://api.cashfree.com', 'https://sandbox.cashfree.com'], form: ['https://api.cashfree.com', 'https://sandbox.cashfree.com'] },
  paypal: { script: ['https://www.paypal.com'], connect: ['https://www.paypal.com', 'https://www.sandbox.paypal.com'], frame: ['https://www.paypal.com', 'https://www.sandbox.paypal.com'], img: ['https://www.paypalobjects.com'] },
  phonepe: {},
}

const loopback = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/

/** An origin with nothing after it: https, or http on this machine for local runs and tests. */
const origin = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return url.origin === value && (url.protocol === 'https:' || loopback.test(value))
  } catch {
    return false
  }
}, 'An origin such as https://assets.example.com, with no path.')

export const storeCspSchema = z.strictObject({
  /** Where the build's scripts, styles and fonts load from besides the page's own origin (LIVE-SHOP §5 step 7). */
  assetOrigin: origin.nullable(),
  /** The store's media and image resizing hosts. */
  mediaOrigins: z.array(origin).max(5),
  analytics: z.array(z.enum(analyticsProviders)).max(3),
  payments: z.array(z.enum(paymentProviders)).max(5),
})

export type StoreCsp = z.infer<typeof storeCspSchema>

export const studioCspSchema = z.strictObject({
  /** The platform's own media host: product photos and core's video (AI-STUDIO §8). */
  mediaOrigin: origin,
  /** The store's portal, the only page that may frame the studio. */
  portalOrigin: origin,
})

export type StudioCsp = z.infer<typeof studioCspSchema>

/** A page's inline scripts and styles, as CSP hash sources ('sha256-…'). */
export type InlineHashes = { scripts: readonly string[]; styles: readonly string[] }

/** The Trusted Types policies a store's page may create: core's, its narrow default, and gtag.js's and GTM's own. */
export const trustedTypesPolicies = ['df-core', 'default', 'goog#html'] as const

const directives = (list: [name: string, sources: readonly string[]][]) =>
  list.map(([name, sources]) => [name, ...new Set(sources)].join(' ')).join('; ')

/** The CSP header for a store's live site and its preview link. */
export const storeCsp = (input: StoreCsp, hashes: InlineHashes): string => {
  const p = storeCspSchema.parse(input)
  const from = (key: keyof Hosts) => [...p.analytics.flatMap((a) => analyticsHosts[a][key] ?? []), ...p.payments.flatMap((k) => paymentHosts[k][key] ?? [])]
  const build = ["'self'", ...(p.assetOrigin ? [p.assetOrigin] : [])]
  return directives([
    ['default-src', ["'none'"]],
    ['script-src', [...build, ...hashes.scripts, ...from('script')]],
    ['style-src', [...build, ...hashes.styles]],
    ['font-src', build],
    ['img-src', ["'self'", ...p.mediaOrigins, ...from('img')]],
    ['media-src', ["'self'", ...p.mediaOrigins]],
    ['connect-src', ["'self'", ...from('connect')]],
    ['frame-src', from('frame').length ? from('frame') : ["'none'"]],
    ['form-action', ["'self'", ...from('form')]],
    ['frame-ancestors', ["'none'"]],
    ['base-uri', ["'none'"]],
    ['object-src', ["'none'"]],
    ['require-trusted-types-for', ["'script'"]],
    ['trusted-types', p.analytics.some((a) => a !== 'meta') ? trustedTypesPolicies : trustedTypesPolicies.filter((t) => t !== 'goog#html')],
  ])
}

/** The studio frame's stricter CSP (§3.5, AI-STUDIO §8): its own origin, the platform's media, framed only by the portal; no inline script at all. */
export const studioCsp = (input: StudioCsp, { styles }: Pick<InlineHashes, 'styles'>): string => {
  const p = studioCspSchema.parse(input)
  return directives([
    ['default-src', ["'none'"]],
    ['script-src', ["'self'"]],
    ['style-src', ["'self'", ...styles]],
    ['font-src', ["'self'"]],
    ['connect-src', ["'self'"]],
    ['img-src', ["'self'", p.mediaOrigin]],
    ['media-src', ["'self'", p.mediaOrigin]],
    ...(['form-action', 'frame-src', 'object-src', 'base-uri', 'manifest-src', 'worker-src'] as const).map((d): [string, string[]] => [d, ["'none'"]]),
    ['frame-ancestors', [p.portalOrigin]],
    ['require-trusted-types-for', ["'script'"]],
    ['trusted-types', ['df-core', 'default']],
  ])
}

const base64 = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes)))

/** A CSP hash source for exactly this text, as the browser hashes an inline script or style. */
export const hashSource = async (text: string): Promise<string> => `'sha256-${base64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))}'`

const inline = (html: string, tag: 'script' | 'style') =>
  [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, 'gi'))].filter((m) => !/(?:^|\s)src\s*=/i.test(m[1] ?? '') && (m[2] ?? '') !== '').map((m) => m[2] ?? '')

/** The hashes of a built page's inline scripts and styles, which its CSP lists. */
export const inlineHashes = async (html: string): Promise<InlineHashes> => ({
  scripts: await Promise.all(inline(html, 'script').map(hashSource)),
  styles: await Promise.all(inline(html, 'style').map(hashSource)),
})

/** The headers the build writes into its manifest for each HTML file, for the edge Worker to send unchanged. */
export const pageHeaders = async (pages: readonly { path: string; html: string }[], csp: (hashes: InlineHashes) => string): Promise<Record<string, { 'content-security-policy': string }>> =>
  Object.fromEntries(await Promise.all(pages.map(async ({ path, html }) => [path, { 'content-security-policy': csp(await inlineHashes(html)) }] as const)))
