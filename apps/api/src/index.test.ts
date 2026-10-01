import { describe, expect, it } from 'vitest'
import worker from './index'

const env = {
  ADMIN_HOST: 'admin.dripfunnel.com',
  PLATFORM_HOST: 'platform.dripfunnel.com',
  HOOKS_HOST: 'hooks.dripfunnel.com',
  HYPERDRIVE: { connectionString: 'not-a-postgres-url' },
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CF_VERSION_METADATA: { id: 'test-version', tag: '' },
  SIGN_IN_RATE_LIMITER: { limit: async () => ({ success: true }) },
}
const ctx = { waitUntil: (promise: Promise<unknown>) => promise } as unknown as ExecutionContext
const call = (href: string, init?: RequestInit) =>
  worker.fetch(
    new Request(href, { ...init, headers: { 'cf-connecting-ip': '203.0.113.1', ...init?.headers } }) as Parameters<typeof worker.fetch>[0],
    env,
    ctx,
  )

const query = (href: string) =>
  call(href, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: new URL(href).origin },
    body: JSON.stringify({ query: '{ health }' }),
  })

describe('worker', () => {
  it('reports health per area, returning 503 and ok: false on a misconfigured database', async () => {
    const response = await call('https://platform.dripfunnel.com/api/health')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, area: 'platform', db: 'down', version: 'test-version' })
    const admin = await call('https://admin.dripfunnel.com/api/health')
    expect(admin.status).toBe(503)
    expect(await admin.json()).toEqual({ ok: false, area: 'admin', db: 'down', version: 'test-version' })
  })

  it('reports ok with an unconfigured db when no HYPERDRIVE binding exists', async () => {
    const withoutHyperdrive = { ...env, HYPERDRIVE: undefined }
    const request = new Request('https://platform.dripfunnel.com/api/health', { headers: { 'cf-connecting-ip': '203.0.113.1' } })
    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], withoutHyperdrive, ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, area: 'platform', db: 'unconfigured', version: 'test-version' })
  })

  it('rate-limits /health', async () => {
    const limited = { ...env, HEALTH_RATE_LIMITER: { limit: async () => ({ success: false }) } }
    const request = new Request('https://platform.dripfunnel.com/api/health', { headers: { 'cf-connecting-ip': '203.0.113.1' } })
    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], limited, ctx)
    expect(response.status).toBe(429)
  })

  it('rejects /health when cf-connecting-ip is missing', async () => {
    const response = await worker.fetch(new Request('https://platform.dripfunnel.com/api/health') as Parameters<typeof worker.fetch>[0], env, ctx)
    expect(response.status).toBe(400)
  })

  it('answers GraphQL on each API', async () => {
    for (const href of ['https://admin.dripfunnel.com/api', 'https://platform.dripfunnel.com/api', 'https://store.partner.com/api', 'https://acme.shops.partner.com/shop-api']) {
      const response = await query(href)
      expect(await response.json()).toEqual({ data: { health: 'ok' } })
    }
  })

  it('answers GraphQL on /api/ with the trailing slash the SPA client sends (client.ts)', async () => {
    const response = await query('https://platform.dripfunnel.com/api/')
    expect(await response.json()).toEqual({ data: { health: 'ok' } })
  })

  it('returns 500 without a payload when required config is missing', async () => {
    const broken = { ...env, PLATFORM_HOST: undefined }
    const response = await worker.fetch(
      new Request('https://platform.dripfunnel.com/api/health', { headers: { 'cf-connecting-ip': '203.0.113.1' } }) as Parameters<typeof worker.fetch>[0],
      broken,
      ctx,
    )
    expect(response.status).toBe(500)
    expect(await response.text()).toBe('')
  })

  it('answers me: null for a stale session cookie when no database is configured', async () => {
    // The console reads `me` to decide whether to offer sign-in, so this branch must not be
    // the error that hides it.
    const withoutHyperdrive = { ...env, HYPERDRIVE: undefined }
    const request = new Request('https://admin.dripfunnel.com/api', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: '__Host-df_admin_session=stale',
        origin: 'https://admin.dripfunnel.com',
      },
      body: JSON.stringify({ query: '{ me { id } }' }),
    })
    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], withoutHyperdrive, ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ data: { me: null } })
  })

  it('answers 503 on sign-in when no database is configured', async () => {
    const withoutHyperdrive = { ...env, HYPERDRIVE: undefined }
    const request = new Request('https://admin.dripfunnel.com/api/auth/sign-in', {
      headers: { 'cf-connecting-ip': '203.0.113.1' },
    })
    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], withoutHyperdrive, ctx)
    expect(response.status).toBe(503)
  })

  it('answers 500 on sign-in when the rate limiter binding is missing', async () => {
    const unlimited = { ...env, SIGN_IN_RATE_LIMITER: undefined }
    const response = await worker.fetch(
      new Request('https://admin.dripfunnel.com/api/auth/sign-in', {
        headers: { 'cf-connecting-ip': '203.0.113.1' },
      }) as Parameters<typeof worker.fetch>[0],
      unlimited,
      ctx,
    )
    expect(response.status).toBe(500)
  })

  it('refuses a cross-origin POST to the admin API, and one with no Origin at all', async () => {
    // The session cookie authenticates these, so without this check #14's and #39's
    // mutations would be reachable from any page (ACCESS.md §4).
    const post = (headers: Record<string, string>) =>
      call('https://admin.dripfunnel.com/api', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ query: '{ health }' }),
      })
    expect((await post({ origin: 'https://evil.example' })).status).toBe(403)
    expect((await post({ origin: 'https://admin.dripfunnel.com.evil.test' })).status).toBe(403)
    expect((await post({})).status).toBe(403)
    expect((await post({ origin: 'https://admin.dripfunnel.com' })).status).toBe(200)
  })

  it('returns 404 outside the known routes', async () => {
    expect((await call('https://admin.dripfunnel.com/shop-api')).status).toBe(404)
    expect((await call('https://platform.dripfunnel.com/shop-api')).status).toBe(404)
    expect((await call('https://store.partner.com/')).status).toBe(404)
    expect((await call('https://hooks.dripfunnel.com/stripe')).status).toBe(404)
  })
})
