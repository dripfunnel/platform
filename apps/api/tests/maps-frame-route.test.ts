import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { factsOf } from '#auth/activity'
import type { PartnerCaller } from '#auth/partnerCaller'
import { secretBox } from '#auth/secretBox'
import { mapFramePathFor, mapFrameScriptPath } from '#hooks/mapFrame'
import { activityLog } from '#saas/activity/index'
import { createPartnerMapsService } from '#saas/partnerCredentials/index'
import worker from '../src/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// The map frame through the Worker itself (#1612): its rate limit, the database it needs, and which store's key each address finds.

const kek = Buffer.alloc(32, 7).toString('base64')
const now = new Date('2026-11-19T09:00:00Z')
const keys = { ns: `AIza${'a'.repeat(31)}NS01`, kl: `AIza${'b'.repeat(31)}KL02` }
const ids = { nsStore: '', klStore: '', noKeyStore: '' }
let db: TestDatabase
let allow = true
const limited: string[] = []

const env = (o: Record<string, unknown> = {}) => ({
  ADMIN_HOST: 'admin.dripfunnel.ai',
  PLATFORM_HOST: 'platform.dripfunnel.ai',
  HOOKS_HOST: 'hooks.dripfunnel.ai',
  CREDENTIALS_KEK: kek,
  HYPERDRIVE: { connectionString: db.url },
  HEALTH_RATE_LIMITER: { limit: async () => ({ success: true }) },
  SHOP_RATE_LIMITER: {
    limit: async ({ key }: { key: string }) => {
      limited.push(key)
      return { success: allow }
    },
  },
  CF_VERSION_METADATA: { id: 'test', tag: '' },
  ...o,
})
const ctx = { waitUntil: (promise: Promise<unknown>) => promise, passThroughOnException: () => undefined } as unknown as ExecutionContext
const frame = (path: string, o: { env?: Record<string, unknown>; ip?: string | null } = {}) => {
  const headers: Record<string, string> = o.ip === null ? {} : { 'cf-connecting-ip': o.ip ?? '203.0.113.9' }
  return worker.fetch(new Request(`https://hooks.dripfunnel.ai${path}`, { headers }) as Parameters<typeof worker.fetch>[0], env(o.env) as never, ctx)
}

const saveKey = async (partnerId: string, key: string) => {
  const caller: PartnerCaller = { role: 'partner-owner', user: { id: crypto.randomUUID(), name: 'Owner', email: 'owner@example.com' }, staff: null, partner: { id: partnerId, name: 'Partner', product: 'Partner Shops', host: null, state: 'live' } }
  const maps = createPartnerMapsService({ sql: db.sql, caller, facts: factsOf(new Request('https://platform.dripfunnel.ai/api', { headers: { 'cf-connecting-ip': '203.0.113.5' } })), activity: activityLog, secrets: await secretBox(kek), checkMaps: async () => ({ status: 'ok' }), now: () => now })
  expect(await maps.save({ key })).toMatchObject({ ok: true })
}

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const partner = async (name: string) => (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  const storeOf = async (partnerId: string) => (await db.sql<{ id: string }[]>`select id from store where partner_id = ${partnerId} order by created_at limit 1`)[0]?.id ?? ''
  const ns = await partner('Northstar Commerce')
  const kl = await partner('Kaufladen Digital')
  ids.nsStore = await storeOf(ns)
  ids.klStore = await storeOf(kl)
  ids.noKeyStore = await storeOf(await partner('Southwind Retail'))
  await saveKey(ns, keys.ns)
  await saveKey(kl, keys.kl)
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the map frame through the Worker', () => {
  it('gives each store its own partner’s key, never another’s', async () => {
    const north = await (await frame(mapFramePathFor(ids.nsStore))).text()
    const kauf = await (await frame(mapFramePathFor(ids.klStore))).text()
    expect(north).toContain(keys.ns)
    expect(north).not.toContain(keys.kl)
    expect(kauf).toContain(keys.kl)
    expect(kauf).not.toContain(keys.ns)
  })

  it('never caches a page that holds a key', async () => {
    expect((await frame(mapFramePathFor(ids.nsStore))).headers.get('cache-control')).toBe('no-store')
  })

  it('answers 404 for a store with no usable key, an unknown store, and a path that is no store’s', async () => {
    expect((await frame(mapFramePathFor(ids.noKeyStore))).status).toBe(404)
    expect((await frame(mapFramePathFor(crypto.randomUUID()))).status).toBe(404)
    expect((await frame('/maps/not-a-store/pin')).status).toBe(404)
    expect((await frame('/maps/pin')).status).toBe(404)
  })

  it('serves the script with no key and no database', async () => {
    const response = await frame(mapFrameScriptPath, { env: { HYPERDRIVE: undefined } })
    expect(response.status).toBe(200)
    expect(await response.text()).not.toContain('AIza')
  })

  it('answers 503 for a store’s page without a database', async () => {
    expect((await frame(mapFramePathFor(ids.nsStore), { env: { HYPERDRIVE: undefined } })).status).toBe(503)
  })

  it('answers 429 with a retry time once the address is over its limit, before reading the database', async () => {
    allow = false
    try {
      const response = await frame(mapFramePathFor(ids.nsStore), { env: { HYPERDRIVE: { connectionString: 'not-a-postgres-url' } } })
      expect(response.status).toBe(429)
      expect(response.headers.get('retry-after')).toBe('60')
    } finally {
      allow = true
    }
  })

  it('limits per address, and keeps a request with no address in one shared bucket instead of refusing it', async () => {
    limited.length = 0
    await frame(mapFramePathFor(ids.nsStore), { ip: '198.51.100.7' })
    const local = await frame(mapFramePathFor(ids.nsStore), { ip: null })
    expect(local.status).toBe(200)
    expect(limited).toEqual(['maps-frame:198.51.100.7', 'maps-frame:unknown'])
  })
})
