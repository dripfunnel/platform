import { describe, expect, it } from 'vitest'
import worker from './index'

const env = { PLATFORM_HOST: 'platform.dripfunnel.com', HOOKS_HOST: 'hooks.dripfunnel.com' }
const call = (href: string, init?: RequestInit) =>
  worker.fetch(new Request(href, init) as Parameters<typeof worker.fetch>[0], env)

const query = (href: string) =>
  call(href, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: '{ health }' }) })

describe('worker', () => {
  it('reports health per area', async () => {
    const response = await call('https://platform.dripfunnel.com/api/health')
    expect(await response.json()).toEqual({ ok: true, area: 'platform' })
  })

  it('answers GraphQL on each API', async () => {
    for (const href of ['https://platform.dripfunnel.com/api', 'https://store.partner.com/api', 'https://acme.shops.partner.com/shop-api']) {
      const response = await query(href)
      expect(await response.json()).toEqual({ data: { health: 'ok' } })
    }
  })

  it('returns 404 outside the known routes', async () => {
    expect((await call('https://platform.dripfunnel.com/shop-api')).status).toBe(404)
    expect((await call('https://store.partner.com/')).status).toBe(404)
    expect((await call('https://hooks.dripfunnel.com/stripe')).status).toBe(404)
  })
})
