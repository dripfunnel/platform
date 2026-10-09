import { describe, expect, it } from 'vitest'
import worker, { guarded, wakeOutbox } from './index'

const env = {
  ADMIN_HOST: 'admin.dripfunnel.com',
  PLATFORM_HOST: 'platform.dripfunnel.com',
  HOOKS_HOST: 'hooks.dripfunnel.com',
  HYPERDRIVE: { connectionString: 'not-a-postgres-url' },
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CF_VERSION_METADATA: { id: 'test-version', tag: '' },
  SIGN_IN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  STAFF_SESSION_RATE_LIMITER: { limit: async () => ({ success: true }) },
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
    expect(await response.json()).toEqual({ ok: false, area: 'platform', db: 'down', version: 'test-version', integrations: { entra: 'missing', stripe: 'missing', ses: 'missing', assets: 'missing' } })
    const admin = await call('https://admin.dripfunnel.com/api/health')
    expect(admin.status).toBe(503)
    expect(await admin.json()).toEqual({ ok: false, area: 'admin', db: 'down', version: 'test-version', integrations: { entra: 'missing', stripe: 'missing', ses: 'missing', assets: 'missing' } })
  })

  it('reports ok with an unconfigured db when no HYPERDRIVE binding exists', async () => {
    const withoutHyperdrive = { ...env, HYPERDRIVE: undefined }
    const request = new Request('https://platform.dripfunnel.com/api/health', { headers: { 'cf-connecting-ip': '203.0.113.1' } })
    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], withoutHyperdrive, ctx)
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, area: 'platform', db: 'unconfigured', version: 'test-version', integrations: { entra: 'missing', stripe: 'missing', ses: 'missing', assets: 'missing' } })
  })

  it('names which integrations are configured, never a value', async () => {
    const configured = {
      ...env,
      ASSETS: {} as R2Bucket,
      ENTRA_TENANT_ID: 't',
      ENTRA_CLIENT_ID: 'c',
      ENTRA_CLIENT_SECRET: 'secret-entra',
      STRIPE_SECRET_KEY: 'rk_test_abc',
      STRIPE_WEBHOOK_SECRET: 'whsec_abc',
    }
    const request = new Request('https://platform.dripfunnel.com/api/health', { headers: { 'cf-connecting-ip': '203.0.113.1' } })
    const text = await (await worker.fetch(request as Parameters<typeof worker.fetch>[0], configured, ctx)).text()
    expect(JSON.parse(text).integrations).toEqual({ entra: 'configured', stripe: 'configured', ses: 'missing', assets: 'configured' })
    expect(text).not.toMatch(/secret-entra|rk_test|whsec_/)
  })

  it('needs all five SES values, and shows none of them', async () => {
    const ses = {
      SES_REGION: 'eu-west-1',
      SES_ACCESS_KEY_ID: 'AKIAsecretkeyid',
      SES_SECRET_ACCESS_KEY: 'secret-ses-access-key',
      SES_SENDER_DOMAIN: 'mail.example.com',
      EMAIL_SUPPRESSION_KEY: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
    }
    const ask = async (extra: Record<string, string | undefined>) => {
      const request = new Request('https://platform.dripfunnel.com/api/health', { headers: { 'cf-connecting-ip': '203.0.113.1' } })
      const text = await (await worker.fetch(request as Parameters<typeof worker.fetch>[0], { ...env, ...extra }, ctx)).text()
      return { text, ses: JSON.parse(text).integrations.ses }
    }
    const all = await ask(ses)
    expect(all.ses).toBe('configured')
    expect(all.text).not.toMatch(/AKIAsecretkeyid|secret-ses-access-key|mail\.example\.com|AAAAAAAA/)
    expect((await ask({ ...ses, EMAIL_SUPPRESSION_KEY: undefined })).ses).toBe('missing')
  })

  it('reports 503 when the environment requires a database and the binding is gone (#30)', async () => {
    const lost = { ...env, HYPERDRIVE: undefined, HYPERDRIVE_REQUIRED: '1' }
    const request = new Request('https://platform.dripfunnel.com/api/health', { headers: { 'cf-connecting-ip': '203.0.113.1' } })
    const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], lost, ctx)
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({ ok: false, area: 'platform', db: 'missing', version: 'test-version', integrations: { entra: 'missing', stripe: 'missing', ses: 'missing', assets: 'missing' } })
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
    for (const href of ['https://admin.dripfunnel.com/api', 'https://platform.dripfunnel.com/api']) {
      const response = await query(href)
      expect(await response.json()).toEqual({ data: { health: 'ok' } })
    }
  })

  // The Shop API knows a storefront host only from the database (docs/ARCHITECTURE.md §2; #306).
  it('answers the Shop API’s health on a storefront host without a database, and its catalogue as unavailable', async () => {
    const withoutHyperdrive = { ...env, HYPERDRIVE: undefined }
    const ask = async (source: string) => {
      const request = new Request('https://acme.shops.partner.com/shop-api', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query: source }) })
      return (await worker.fetch(request as Parameters<typeof worker.fetch>[0], withoutHyperdrive, ctx)).json()
    }
    expect(await ask('{ health }')).toEqual({ data: { health: 'ok' } })
    expect(await ask('{ store { name } }')).toMatchObject({ data: { store: null }, errors: [{ extensions: { code: 'STORE_UNAVAILABLE' } }] })
  })

  it('rate-limits the Shop API per host and address, refuses a call with no address, and serves nothing without either limiter', async () => {
    const carts = { limit: async () => ({ success: true }) }
    const limited = { ...env, SHOP_RATE_LIMITER: { limit: async () => ({ success: false }) }, CART_RATE_LIMITER: carts }
    const asked = (headers: Record<string, string>) => new Request('https://acme.shops.partner.com/shop-api', { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ query: '{ health }' }) })
    expect((await worker.fetch(asked({ 'cf-connecting-ip': '203.0.113.1' }) as Parameters<typeof worker.fetch>[0], limited, ctx)).status).toBe(429)
    const open = { ...env, SHOP_RATE_LIMITER: { limit: async () => ({ success: true }) }, CART_RATE_LIMITER: carts }
    expect((await worker.fetch(asked({}) as Parameters<typeof worker.fetch>[0], open, ctx)).status).toBe(429)
    expect((await worker.fetch(asked({ 'cf-connecting-ip': '203.0.113.1' }) as Parameters<typeof worker.fetch>[0], env, ctx)).status).toBe(500)
    // Without the new-cart limiter, nothing is served rather than unlimited carts.
    expect((await worker.fetch(asked({ 'cf-connecting-ip': '203.0.113.1' }) as Parameters<typeof worker.fetch>[0], { ...open, CART_RATE_LIMITER: undefined }, ctx)).status).toBe(500)
  })

  it('answers GraphQL on /api/ with the trailing slash the SPA client sends (client.ts)', async () => {
    for (const href of ['https://admin.dripfunnel.com/api/', 'https://platform.dripfunnel.com/api/']) {
      const response = await query(href)
      expect(await response.json()).toEqual({ data: { health: 'ok' } })
    }
  })

  // The Store API knows a portal host only from the database (docs/ARCHITECTURE.md §2; #288).
  it('answers the Store API on a portal host without a database, signed out', async () => {
    const withoutHyperdrive = { ...env, HYPERDRIVE: undefined }
    for (const href of ['https://store.partner.com/api', 'https://store.partner.com/api/']) {
      const request = new Request(href, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://store.partner.com' }, body: JSON.stringify({ query: '{ health }' }) })
      const response = await worker.fetch(request as Parameters<typeof worker.fetch>[0], withoutHyperdrive, ctx)
      expect(await response.json()).toEqual({ data: { health: 'ok' } })
    }
  })

  it('fails a Store API request rather than answering it when the database is down', async () => {
    const response = await query('https://store.partner.com/api/')
    expect(response.status).toBeGreaterThanOrEqual(500)
  })

  it('refuses a Store API mutation posted from another origin', async () => {
    const response = await call('https://store.partner.com/api/', { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ query: '{ health }' }) })
    expect(response.status).toBe(403)
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

describe('guarded', () => {
  it('turns an error nothing caught into a bodyless 500 and one log line by code, never the message', async () => {
    const lines: string[] = []
    const log = console.log
    console.log = (line: string) => void lines.push(line)
    let result: Awaited<ReturnType<typeof guarded>>
    try {
      result = await guarded(new Request('https://admin.dripfunnel.com/api/', { headers: { 'cf-ray': 'ray-500' } }), () =>
        Promise.reject(Object.assign(new Error('permission denied to set role "app_system" for user app_login'), { name: 'PostgresError', code: '42501' })),
      )
    } finally {
      console.log = log
    }
    expect(result.response.status).toBe(500)
    expect(await result.response.text()).toBe('')
    expect(result.area).toBeNull()
    expect(lines.map((l) => JSON.parse(l) as Record<string, unknown>)).toEqual([{ event: 'request_failed', requestId: 'ray-500', host: 'admin.dripfunnel.com', status: 500, code: 'PostgresError:42501' }])
    expect(lines.join('\n')).not.toContain('app_login')
  })

  it('passes a response through untouched', async () => {
    const result = await guarded(new Request('https://admin.dripfunnel.com/api/'), async () => ({ response: new Response('ok', { status: 200 }), area: 'admin' as const }))
    expect(result.response.status).toBe(200)
    expect(result.area).toBe('admin')
  })
})

describe('the outbox wake', () => {
  const asked = (method: string, status: number, send: () => Promise<void> = async () => undefined, bound = true) => {
    const sent: unknown[] = []
    const waiting: Promise<unknown>[] = []
    const queue = { send: async (message: unknown) => (sent.push(message), send()) }
    wakeOutbox(
      new Request('https://store.example.com/api', { method }),
      new Response(null, { status }),
      (bound ? { ...env, OUTBOX_WAKE: queue } : env) as never,
      { waitUntil: (promise: Promise<unknown>) => void waiting.push(promise) } as unknown as ExecutionContext,
    )
    return Promise.all(waiting).then(() => sent)
  }
  const logged = async (work: () => Promise<unknown>): Promise<string[]> => {
    const lines: string[] = []
    const log = console.log
    console.log = (line: string) => void lines.push(line)
    try {
      await work()
    } finally {
      console.log = log
    }
    return lines
  }

  it('sends one wake after a write that succeeded', async () => {
    for (const status of [200, 201, 204]) expect(await asked('POST', status)).toHaveLength(1)
  })

  it('sends none after GET, HEAD or OPTIONS, or after a request that was refused or failed', async () => {
    for (const method of ['GET', 'HEAD', 'OPTIONS']) expect(await asked(method, 200)).toHaveLength(0)
    for (const status of [302, 400, 401, 403, 404, 429, 500]) expect(await asked('POST', status)).toHaveLength(0)
  })

  it('sends nothing, and breaks nothing, with no queue bound', async () => {
    expect(await asked('POST', 200, undefined, false)).toHaveLength(0)
  })

  it('logs a failed send by code only, and the response is not involved', async () => {
    const lines = await logged(() => asked('POST', 200, () => Promise.reject(Object.assign(new Error('queue down at https://secret.example'), { name: 'QueueError' }))))
    expect(lines.some((l) => l.includes('"event":"outbox_wake_failed"') && l.includes('QueueError'))).toBe(true)
    expect(lines.join('\n')).not.toContain('secret.example')
  })
})

describe('the outbox wake consumer', () => {
  const batchOf = (n: number) => {
    const acked: string[] = []
    const batch = { messages: Array.from({ length: n }, (_, i) => ({ id: `m${i}`, body: { at: i } })), ackAll: () => void acked.push('all'), retryAll: () => void acked.push('retry') }
    return { batch, acked }
  }
  const sweeps = (lines: string[]) => lines.filter((l) => l.includes('"event":"relay_skipped"'))

  it('runs one outbox sweep for a batch of many wakes, and acks the batch', async () => {
    const { batch, acked } = batchOf(5)
    const lines: string[] = []
    const log = console.log
    console.log = (line: string) => void lines.push(line)
    try {
      await worker.queue(batch as never, { ...env, HOOKS_HOST: undefined } as never)
    } finally {
      console.log = log
    }
    expect(sweeps(lines)).toHaveLength(1)
    expect(acked).toEqual(['all'])
  })

  it('does not run the cleanups a cron run does', async () => {
    const lines: string[] = []
    const log = console.log
    console.log = (line: string) => void lines.push(line)
    try {
      await worker.queue(batchOf(1).batch as never, { ...env, HOOKS_HOST: undefined } as never)
      const afterQueue = sweeps(lines).length
      await worker.scheduled({} as never, { ...env, HOOKS_HOST: undefined } as never)
      expect(afterQueue).toBe(1)
      expect(sweeps(lines).length - afterQueue).toBe(2)
    } finally {
      console.log = log
    }
  })

  it('leaves the batch unacked when the sweep throws, so the queue redelivers it and cron is the backstop', async () => {
    const { batch, acked } = batchOf(2)
    const unreachable = { ...env, HYPERDRIVE: { connectionString: 'postgres://u:p@127.0.0.1:1/none?connect_timeout=1' } }
    await expect(worker.queue(batch as never, unreachable as never)).rejects.toThrow()
    expect(acked).toEqual([])
  })
})
