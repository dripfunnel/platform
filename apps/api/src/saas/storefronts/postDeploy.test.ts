import { describe, expect, it } from 'vitest'
import type { EdgeProbe, ProbeAnswer } from '#integrations/http/edgeProbe'
import { failedCheck, runPostDeployChecks, type CheckTarget } from './postDeploy'

const target: CheckTarget = { host: 'shop.example', buildId: 'b2', files: ['index.html', 'products/_fallback/index.html', 'products/blue-mug/index.html', 'checkout/index.html', 'hi-in/checkout/index.html', 'assets/app.js'] }
const html = (body = ''): ProbeAnswer => ({ status: 200, contentType: 'text/html; charset=utf-8', build: 'b2', body })

const probeWith = (pages: Record<string, ProbeAnswer>, shop: Record<string, unknown> = {}): EdgeProbe & { asked: string[] } => {
  const asked: string[] = []
  return {
    asked,
    get: async (url) => {
      asked.push(url)
      return pages[url] ?? { status: 404, contentType: '', build: null, body: '' }
    },
    shop: async (_, query) => {
      const key = Object.keys(shop).find((k) => query.includes(k))
      return key ? { status: 200, data: shop[key], errors: false } : { status: 500, data: null, errors: true }
    },
  }
}
const timing = () => {
  let now = 0
  return { now: () => now, wait: async (ms: number) => void (now += ms) }
}
const healthy = {
  'https://shop.example/': html('<script src="/assets/app.js"></script><link rel="stylesheet" href="https://cdn.example/a.css">'),
  'https://shop.example/assets/app.js': { status: 200, contentType: 'text/javascript', build: 'b2', body: '' },
  'https://cdn.example/a.css': { status: 200, contentType: 'text/css', build: null, body: '' },
  'https://shop.example/products/blue-mug': html(),
  'https://shop.example/checkout': html(),
}
const shopOk = { product: { product: { versions: [{ id: 'v1' }] } }, paymentOptions: { paymentOptions: [{ provider: 'stripe', kind: 'card', publicKey: 'pk_test_1' }] } }

describe('the post-deploy checks', () => {
  it('check home, a product, the cart, checkout and the payment setup, with each page’s scripts and stylesheets', async () => {
    const probe = probeWith(healthy, shopOk)
    const results = await runPostDeployChecks(probe, target, timing())
    expect(results.map((r) => [r.name, r.result])).toEqual([
      ['home', 'passed'],
      ['product', 'passed'],
      ['cart', 'passed'],
      ['checkout', 'passed'],
      ['payment', 'passed'],
    ])
    expect(probe.asked).toContain('https://cdn.example/a.css')
    expect(failedCheck(results)).toBeNull()
  })

  it('fail a card payment with no key for its element, and a Shop API that doesn’t answer', async () => {
    const keyless = await runPostDeployChecks(probeWith(healthy, { ...shopOk, paymentOptions: { paymentOptions: [{ provider: 'stripe', kind: 'card', publicKey: null }] } }), target, timing())
    expect(failedCheck(keyless)).toBe('check_payment')
    const down = await runPostDeployChecks(probeWith(healthy, {}), target, timing())
    expect(down.filter((r) => r.result === 'failed').map((r) => r.name)).toEqual(['cart', 'payment'])
  })

  it('skip what a store doesn’t have: no product page, no way to pay', async () => {
    const results = await runPostDeployChecks(probeWith(healthy, { paymentOptions: { paymentOptions: [] } }), { ...target, files: ['index.html', 'products/_fallback/index.html', 'checkout/index.html'] }, timing())
    expect(results.map((r) => r.result)).toEqual(['passed', 'skipped', 'skipped', 'passed', 'skipped'])
  })

  it('fail a build with no checkout page, and a page that isn’t HTML', async () => {
    expect(failedCheck(await runPostDeployChecks(probeWith(healthy, shopOk), { ...target, files: ['index.html'] }, timing()))).toBe('check_checkout')
    const notHtml = { ...healthy, 'https://shop.example/': { ...html(), contentType: 'application/json' } }
    expect(failedCheck(await runPostDeployChecks(probeWith(notHtml, shopOk), target, timing()))).toBe('check_home')
  })
})
