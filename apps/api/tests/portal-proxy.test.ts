import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import worker, { PortalProxy } from '../src/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #426: a partner's own portal host reaches the Store API only through store-proxy's binding (SAAS.md §8).

let db: TestDatabase
let t: Tenants
const hostA = 'store.partner-a.example'
const hostB = 'portal.partner-b.example'
const pending = 'store.pending.example'
const ownHost = 'store.dripfunnel.com'

const env = {
  ADMIN_HOST: 'admin.dripfunnel.com',
  PLATFORM_HOST: 'platform.dripfunnel.com',
  HOOKS_HOST: 'hooks.dripfunnel.com',
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SIGN_IN_RATE_LIMITER: { limit: async () => ({ success: true }) },
  CF_VERSION_METADATA: { id: 'test', tag: '' },
}
const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext

const brandQuery = (host: string) =>
  new Request(`https://${host}/api/`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `https://${host}`, 'cf-connecting-ip': '203.0.113.5' }, body: JSON.stringify({ query: '{ brand { productName } }' }) })

const answer = async (response: Response) => ({ status: response.status, name: response.status === 200 ? ((await response.json()) as { data: { brand: { productName: string } | null } }).data.brand?.productName : undefined })
const viaProxy = async (host: string) => answer(await new PortalProxy(ctx, { ...env, HYPERDRIVE: { connectionString: db.url } } as never).fetch(brandQuery(host)))
const viaPublic = async (host: string) => answer(await worker.fetch(brandQuery(host) as Parameters<typeof worker.fetch>[0], { ...env, HYPERDRIVE: { connectionString: db.url } } as never, ctx))

const setStatus = (host: string, status: string) => db.sql`update partner_domain set status = ${status} where host = ${host}`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  const [other] = await db.sql<{ id: string }[]>`insert into partner (name) values ('Partner C') returning id`
  const [ours] = await db.sql<{ id: string }[]>`insert into partner (name) values ('DripFunnel') returning id`
  await db.sql`
    insert into partner_domain (partner_id, kind, host, status, record_type, expected) values
      (${t.partnerA}, 'portal', ${hostA}, 'live', 'CNAME', 'x'),
      (${t.partnerB}, 'portal', ${hostB}, 'live', 'CNAME', 'x'),
      (${other?.id ?? ''}, 'portal', ${pending}, 'waiting', 'CNAME', 'x'),
      (${t.partnerA}, 'email', 'mail.partner-a.example', 'live', 'CNAME', 'x'),
      (${ours?.id ?? ''}, 'portal', ${ownHost}, 'live', 'CNAME', 'x')
  `
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the PortalProxy entrypoint', () => {
  it('reaches the Store API with the partner whose live portal host it is', async () => {
    expect(await viaProxy(hostA)).toEqual({ status: 200, name: 'Partner A' })
    expect(await viaProxy(hostA.toUpperCase())).toEqual({ status: 200, name: 'Partner A' })
  })

  it('never resolves one partner’s host to another partner', async () => {
    expect(await viaProxy(hostB)).toEqual({ status: 200, name: 'Partner B' })
    expect(await viaProxy(hostA)).toEqual({ status: 200, name: 'Partner A' })
  })

  it('answers 404 on a host no partner holds, or one that is not a portal', async () => {
    expect((await viaProxy('store.nobody.example')).status).toBe(404)
    expect((await viaProxy('mail.partner-a.example')).status).toBe(404)
  })

  it('answers 404 on a portal host until it is live, and keeps serving it once it has been', async () => {
    for (const status of ['waiting', 'verifying', 'issuing', 'failed']) {
      await setStatus(pending, status)
      expect((await viaProxy(pending)).status, status).toBe(404)
    }
    for (const status of ['live', 'expiring', 'broken']) {
      await setStatus(pending, status)
      expect((await viaProxy(pending)), status).toEqual({ status: 200, name: 'Partner C' })
    }
  })

  it('answers 404 on a closed partner’s host', async () => {
    await db.sql`update partner set state = 'closed' where id = ${t.partnerB}`
    try {
      expect((await viaProxy(hostB)).status).toBe(404)
    } finally {
      await db.sql`update partner set state = 'draft' where id = ${t.partnerB}`
    }
  })
})

describe('PortalProxy.portalHost (#899)', () => {
  const asks = (host: string) => new PortalProxy(ctx, { ...env, HYPERDRIVE: { connectionString: db.url } } as never).portalHost(host)

  it('says yes only for a live portal host, ours included, and no for our other hosts', async () => {
    expect(await asks(ownHost)).toBe(true)
    expect(await asks(ownHost.toUpperCase())).toBe(true)
    for (const host of ['store2.dripfunnel.com', 'admin.dripfunnel.com', 'platform.dripfunnel.com', 'hooks.dripfunnel.com', 'mail.partner-a.example']) expect(await asks(host), host).toBe(false)
  })
})

describe('the public fetch', () => {
  it('gives a forged Host of a registered partner nothing of that partner’s', async () => {
    for (const host of [hostA, hostB]) {
      expect(await viaPublic(host)).toEqual({ status: 404, name: undefined })
    }
  })

  it('still serves a registered portal host on our own zone, which has a route of its own', async () => {
    expect(await viaPublic(ownHost)).toEqual({ status: 200, name: 'DripFunnel' })
    expect((await viaPublic('store2.dripfunnel.com')).status).toBe(404)
  })
})
