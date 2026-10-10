import { describe, expect, it } from 'vitest'
import { hashSource, inlineHashes, pageHeaders, storeCsp, studioCsp, type StoreCsp } from './csp'

const store: StoreCsp = { assetOrigin: 'https://assets.webpreview.store', mediaOrigins: ['https://media.dripfunnel.com'], analytics: ['ga4', 'meta'], payments: ['stripe'] }
const none = { scripts: [], styles: [] }

const directive = (csp: string, name: string) => csp.split('; ').find((d) => d.startsWith(`${name} `))

describe('storeCsp', () => {
  it('allows only the build, the store’s media and the hosts of what the store set up', () => {
    const csp = storeCsp(store, { scripts: ["'sha256-abc='"], styles: [] })
    expect(directive(csp, 'default-src')).toBe("default-src 'none'")
    expect(directive(csp, 'script-src')).toBe("script-src 'self' https://assets.webpreview.store 'sha256-abc=' https://www.googletagmanager.com https://connect.facebook.net https://js.stripe.com")
    expect(directive(csp, 'connect-src')).toContain("connect-src 'self' https://*.google-analytics.com")
    expect(directive(csp, 'img-src')).toBe("img-src 'self' https://media.dripfunnel.com https://*.google-analytics.com https://www.googletagmanager.com https://www.facebook.com")
    expect(directive(csp, 'frame-src')).toBe('frame-src https://js.stripe.com https://hooks.stripe.com')
    expect(directive(csp, 'form-action')).toBe("form-action 'self' https://hooks.stripe.com")
    expect(directive(csp, 'require-trusted-types-for')).toBe("require-trusted-types-for 'script'")
    expect(directive(csp, 'trusted-types')).toBe('trusted-types df-core default goog#html')
  })

  it('names no analytics or payment host a store hasn’t set up, and no goog#html without Google', () => {
    const csp = storeCsp({ ...store, analytics: ['meta'], payments: [] }, none)
    expect(csp).not.toContain('google')
    expect(csp).not.toContain('stripe')
    expect(directive(csp, 'frame-src')).toBe("frame-src 'none'")
    expect(directive(csp, 'trusted-types')).toBe('trusted-types df-core default')
  })

  it('is built from hashes only: the same build gives the same header, with no nonce', () => {
    const first = storeCsp(store, { scripts: ["'sha256-abc='"], styles: ["'sha256-def='"] })
    expect(storeCsp(store, { scripts: ["'sha256-abc='"], styles: ["'sha256-def='"] })).toBe(first)
    expect(first).not.toMatch(/nonce|unsafe-inline|unsafe-eval|\*;|\s\*\s/)
  })

  it('refuses an origin with a path, plain http, or an unknown provider', () => {
    expect(() => storeCsp({ ...store, assetOrigin: 'https://assets.example.com/x' }, none)).toThrow()
    expect(() => storeCsp({ ...store, mediaOrigins: ['http://media.example.com'] }, none)).toThrow()
    expect(() => storeCsp({ ...store, analytics: ['hotjar' as 'ga4'] }, none)).toThrow()
  })
})

describe('studioCsp', () => {
  it('is its own origin, the platform’s media and nothing else, framed only by the portal', () => {
    expect(studioCsp({ mediaOrigin: 'https://media.dripfunnel.com', portalOrigin: 'https://shop.partner.com' }, { styles: ["'sha256-s='"] })).toBe(
      [
        "default-src 'none'",
        "script-src 'self'",
        "style-src 'self' 'sha256-s='",
        "font-src 'self'",
        "connect-src 'self'",
        "img-src 'self' https://media.dripfunnel.com",
        "media-src 'self' https://media.dripfunnel.com",
        "form-action 'none'",
        "frame-src 'none'",
        "object-src 'none'",
        "base-uri 'none'",
        "manifest-src 'none'",
        "worker-src 'none'",
        'frame-ancestors https://shop.partner.com',
        "require-trusted-types-for 'script'",
        'trusted-types df-core default',
      ].join('; '),
    )
  })
})

describe('inlineHashes and pageHeaders', () => {
  it('hash each inline script and style exactly, and leave out scripts with a src', async () => {
    const html = '<style>p{color:red}</style><script>self.a=1</script><script src="/x.js"></script><script data-src="y">self.b=2</script><script type="application/json">{}</script>'
    expect(await inlineHashes(html)).toEqual({ scripts: [await hashSource('self.a=1'), await hashSource('self.b=2'), await hashSource('{}')], styles: [await hashSource('p{color:red}')] })
    expect(await hashSource('abc')).toBe("'sha256-ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0='")
  })

  it('give each page of a build its own header, for the edge Worker to send unchanged', async () => {
    const headers = await pageHeaders([{ path: 'index.html', html: '<script>self.a=1</script>' }, { path: 'cart/index.html', html: '' }], (h) => storeCsp(store, h))
    expect(Object.keys(headers)).toEqual(['index.html', 'cart/index.html'])
    expect(headers['index.html']?.['content-security-policy']).toContain(await hashSource('self.a=1'))
    expect(headers['cart/index.html']?.['content-security-policy']).not.toContain('sha256')
  })
})
