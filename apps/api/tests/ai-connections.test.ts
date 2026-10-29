import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { upsertStoreAiAccount } from '#db/scoped/storeAiAccount'
import { activityLog } from '#saas/activity/index'
import { createAiConnections } from '#saas/aiConnections/index'
import { createAiOAuth, sealTokens } from '#saas/aiOAuth/index'
import { OAuthError, type OAuthProviders, type OAuthTokens } from '#integrations/ai/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// AI connections as managed records (docs/api/SAAS.md §9.3): isolation, health, cooldown, authorized fallback and one refresh.

let db: TestDatabase
let t: Tenants
let box: SecretBox
const now = new Date('2026-10-28T09:00:00Z')
const kek = Buffer.alloc(32, 9).toString('base64')
const refreshed: string[] = []
let refreshOutcome: 'ok' | 'rejected' = 'ok'

const fresh = (n: number): OAuthTokens => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresAt: now.getTime() + 3_600_000, accountLabel: null, accountId: null })
const stale = (n: number): OAuthTokens => ({ ...fresh(n), expiresAt: now.getTime() - 1000 })

const providers: OAuthProviders = {
  anthropic: {
    id: 'anthropic',
    redirectUri: 'http://localhost/cb',
    availability: () => ({ available: true }),
    authorizeUrl: () => 'https://auth.example/',
    exchangeCode: () => Promise.reject(new OAuthError('EXCHANGE_FAILED')),
    refresh: async (old) => {
      refreshed.push(old.refreshToken ?? '')
      await new Promise((r) => setTimeout(r, 30))
      if (refreshOutcome === 'rejected') throw new OAuthError('REFRESH_REJECTED')
      return fresh(refreshed.length + 100)
    },
    revoke: () => Promise.resolve(),
    chat: () => {
      throw new Error('unused')
    },
  },
  openai: undefined as never,
}

const connectionsFor = (storeId: string, partnerId: string) => createAiConnections({ sql: db.sql, context: { partnerId, storeId, sellerId: null } as never, secrets: box, oauth: createAiOAuth({ sql: db.sql, secrets: box, providers, now: () => now }), now: () => now })
const a = () => connectionsFor(t.storeA1, t.partnerA)
const b = () => connectionsFor(t.storeB1, t.partnerB)

const putStoreKey = async (storeId: string, key: string, extra: { fallback?: boolean } = {}) =>
  db.sql`insert into store_ai_account (store_id, provider, key_enc, key_prefix, status, connected_by, fallback_authorized) values (${storeId}, 'anthropic', ${await box.seal(key)}, 'sk-ant-…', 'ok', 'Olivia', ${extra.fallback ?? false})
    on conflict (store_id) do update set key_enc = excluded.key_enc, auth_type = 'api_key', status = 'ok', fallback_authorized = excluded.fallback_authorized, cooldown_until = null, last_validation_status = null`
const putPartnerKey = async (partnerId: string, key: string): Promise<string> =>
  (await db.sql<{ id: string }[]>`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, status, is_default, created_by) values (${partnerId}, 'ai', 'anthropic', ${`p-${Math.random()}`}, ${await box.seal(key)}, 'sk-ant-…', 'ok', true, 'Maya') returning id`)[0]?.id ?? ''

type Who = 'owner' | 'manager' | 'bOwner'
const cookies: Record<Who, string> = { owner: '', manager: '', bOwner: '' }
const storeOf = (w: Who) => (w === 'bOwner' ? t.storeB1 : t.storeA1)
const partnerOf = (w: Who) => (w === 'bOwner' ? t.partnerB : t.partnerA)
const facts = { requestId: 'r', ip: null, userAgent: null }
const run = async (who: Who, source: string, variables: Record<string, unknown> = {}) => {
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who) } }), partnerOf(who), now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: partnerOf(who), sql: db.sql, activity: activityLog, facts, secrets: box, checkAiKey: () => Promise.resolve('ok'), now: () => now }
  const r = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: r.data as Record<string, unknown> | null | undefined, code: r.errors?.[0]?.extensions['code'] as string | undefined }
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  box = await secretBox(kek)
  for (const [who, role, email] of [['owner', 'owner', 'o@a.example'], ['manager', 'manager', 'm@a.example'], ['bOwner', 'owner', 'o@b.example']] as const) {
    const id = (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerOf(who)}, ${email}, ${who}, 'active') returning id`)[0]?.id ?? ''
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${id}, ${storeOf(who)}, ${role}, 'active')`
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id, partnerId: partnerOf(who) }, now))
  }
}, 60_000)
afterAll(async () => {
  await db?.drop()
})
beforeEach(async () => {
  refreshed.length = 0
  refreshOutcome = 'ok'
  await db.sql`delete from store_ai_account`
  await db.sql`delete from partner_credential`
})

describe('tenant isolation', () => {
  it("never resolves, reads or changes another tenant's connection", async () => {
    const aCred = await putPartnerKey(t.partnerA, 'sk-ant-partnerA-secret-000000')
    await putStoreKey(t.storeB1, 'sk-ant-storeB-secret-0000000')
    await putPartnerKey(t.partnerB, 'sk-ant-partnerB-secret-000000')

    expect((await a().resolveConnections('plan')).map((c) => c.secret)).toEqual(['sk-ant-partnerA-secret-000000'])
    expect(await a().resolveConnections('own_key')).toEqual([])
    expect((await b().resolveConnections('own_key')).map((c) => c.secret)).toEqual(['sk-ant-storeB-secret-0000000'])

    expect(await b().health(`partner:${aCred}`)).toBeNull()
    expect(await a().health(`store:${t.storeB1}`)).toBeNull()
    await b().startCooldown(`partner:${aCred}`, 60)
    await b().markValidated(`partner:${aCred}`, 'rejected')
    await a().startCooldown(`store:${t.storeB1}`, 60)
    expect((await db.sql`select cooldown_until, last_validation_status from partner_credential where id = ${aCred}`)[0]).toEqual({ cooldown_until: null, last_validation_status: null })
    expect((await db.sql`select cooldown_until from store_ai_account where store_id = ${t.storeB1}`)[0]).toEqual({ cooldown_until: null })
  })

  it('keeps the sealed key from every request role, and the health columns readable', async () => {
    await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000')
    for (const role of ['app_request', 'app_partner', 'app_platform'])
      await expect(db.sql.begin(async (tx) => { await tx.unsafe(`set local role ${role}`); await tx`select key_enc from store_ai_account` })).rejects.toThrow(/permission denied/)
    await db.sql.begin(async (tx) => {
      await tx.unsafe('set local role app_request')
      await tx`select set_config('app.scope', 'store', true)`
      await tx`select set_config('app.store_id', ${t.storeA1}, true)`
      await tx`select set_config('app.seller_id', '', true)`
      expect(await tx`select cooldown_until, fallback_authorized, preferred_model from store_ai_account`).toHaveLength(1)
    })
  })
})

describe('status, cooldown and preferred model', () => {
  it('reports a rejected key and a rejected sign-in as needing attention, and an expired-then-rejected refresh as needs_reconnect', async () => {
    await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000')
    await a().markValidated(`store:${t.storeA1}`, 'rejected')
    expect((await a().health(`store:${t.storeA1}`))?.status).toBe('rejected')
    expect(await a().resolveConnections('own_key')).toEqual([])

    await db.sql`update store_ai_account set auth_type = 'oauth', status = 'ok', key_enc = ${await sealTokens(box, stale(1))}`
    refreshOutcome = 'rejected'
    expect(await a().resolveConnections('own_key', true)).toEqual([])
    expect(refreshed).toEqual(['refresh-1'])
    expect(await a().health(`store:${t.storeA1}`)).toMatchObject({ status: 'needs_reconnect', authType: 'oauth', lastValidationStatus: 'rejected' })
  })

  it('does not let /api/v1 use a sign-in, but lets the studio', async () => {
    await putStoreKey(t.storeA1, 'x')
    await db.sql`update store_ai_account set auth_type = 'oauth', key_enc = ${await sealTokens(box, fresh(1))}`
    expect(await a().resolveConnections('own_key')).toEqual([])
    expect((await a().resolveConnections('own_key', true)).map((c) => c.secret)).toEqual(['access-1'])
  })

  it('cools down for the provider\'s wait, bounded, never shortened, and expires by itself', async () => {
    await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000')
    const id = `store:${t.storeA1}`
    expect(await a().startCooldown(id, 120)).toEqual(new Date(now.getTime() + 120_000))
    expect(await a().isCoolingDown(id)).toBe(true)
    expect(await a().resolveConnections('own_key')).toEqual([])
    expect(await a().startCooldown(id, 5)).toEqual(new Date(now.getTime() + 5_000))
    expect((await db.sql<{ c: Date }[]>`select cooldown_until as c from store_ai_account`)[0]?.c).toEqual(new Date(now.getTime() + 120_000))
    await a().startCooldown(id, 999_999)
    expect((await db.sql<{ c: Date }[]>`select cooldown_until as c from store_ai_account`)[0]?.c).toEqual(new Date(now.getTime() + 900_000))
    await db.sql`update store_ai_account set cooldown_until = ${new Date(now.getTime() - 1)}`
    expect(await a().isCoolingDown(id)).toBe(false)
    expect(await a().resolveConnections('own_key')).toHaveLength(1)
    await a().startCooldown(id, null)
    expect((await a().health(id))?.status).toBe('cooling_down')
    await a().endCooldown(id)
    expect((await a().health(id))?.status).toBe('ok')
  })

  it('cools one model alone: the others on the same connection stay usable', async () => {
    await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000')
    const id = `store:${t.storeA1}`
    await a().startCooldown(id, 60, 'claude-sonnet-5-5')
    expect(await a().isCoolingDown(id, 'claude-sonnet-5-5')).toBe(true)
    expect(await a().isCoolingDown(id, 'claude-haiku-4-5')).toBe(false)
    expect(await a().isCoolingDown(id)).toBe(false)
    expect(await a().resolveConnections('own_key')).toHaveLength(1)
    await a().endCooldown(id)
    expect(await a().isCoolingDown(id, 'claude-sonnet-5-5')).toBe(false)
  })

  it('records validation without marking the account rejected on an outage, and carries the preferred model', async () => {
    await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000')
    const id = `store:${t.storeA1}`
    await a().markValidated(id, 'unavailable')
    expect(await a().health(id)).toMatchObject({ status: 'unavailable', lastValidationStatus: 'unavailable', lastValidatedAt: now })
    expect(await a().resolveConnections('own_key')).toHaveLength(1)
    await a().markValidated(id, 'ok')
    await a().setPreferred(id, 'claude-sonnet-4-5')
    expect((await a().resolveConnections('own_key'))[0]).toMatchObject({ preferredModel: 'claude-sonnet-4-5', provider: 'anthropic', authType: 'api_key' })
    expect((await a().health(id))?.status).toBe('ok')
  })
})

describe('fallback', () => {
  it('adds the store\'s own account behind the partner\'s default only when its Owner authorized it', async () => {
    await putPartnerKey(t.partnerA, 'sk-ant-partnerA-secret-000000')
    await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000')
    expect((await a().resolveConnections('plan')).map((c) => c.connectionId.split(':')[0])).toEqual(['partner'])
    await db.sql`update store_ai_account set fallback_authorized = true where store_id = ${t.storeA1}`
    expect((await a().resolveConnections('plan')).map((c) => c.connectionId.split(':')[0])).toEqual(['partner', 'store'])
    // A cooled primary is skipped: the authorized fallback is what remains, a rotation to nobody else's credential.
    const [cred] = await db.sql<{ id: string }[]>`select id from partner_credential`
    await a().startCooldown(`partner:${cred?.id}`, 60)
    expect((await a().resolveConnections('plan')).map((c) => c.connectionId.split(':')[0])).toEqual(['store'])
    expect((await b().resolveConnections('plan')).filter((c) => c.secret.includes('A-secret'))).toEqual([])
  })

  it('is switched off when the store connects a different account, so consent never carries to a new payer', async () => {
    await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000', { fallback: true })
    await withSystemScope(db.sql, (tx) => upsertStoreAiAccount(tx, { storeId: t.storeA1, provider: 'openai', keyEnc: 'sealed', keyPrefix: 'sk-…', status: 'ok', testedAt: null, connectedBy: 'Olivia', at: now }))
    expect(await db.sql`select fallback_authorized from store_ai_account where store_id = ${t.storeA1}`).toEqual([{ fallback_authorized: false }])
  })

  it('is set by the Owner only through the store API, audited once, and never on another store\'s account', async () => {
    await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000')
    const set = (who: Who, on: boolean) => run(who, 'mutation($on: Boolean!) { setStoreAiFallback(on: $on) }', { on })
    expect((await set('manager', true)).code).toBe('FORBIDDEN')
    expect((await set('bOwner', true)).code).toBe('NOT_FOUND')
    expect((await set('owner', true)).data?.['setStoreAiFallback']).toBe(true)
    expect((await set('owner', true)).data?.['setStoreAiFallback']).toBe(true)
    expect((await run('owner', '{ storeAiAccount { fallbackAuthorized } }')).data?.['storeAiAccount']).toEqual({ fallbackAuthorized: true })
    expect(await db.sql`select action from activity_log where store_id = ${t.storeA1} and action = 'store.ai_fallback_changed'`).toHaveLength(1)
    expect((await a().resolveConnections('own_key')).length).toBe(1)
  })
})

describe('refresh', () => {
  it('shares one upstream refresh between concurrent callers, and hands both the same secret', async () => {
    await putStoreKey(t.storeA1, 'x')
    await db.sql`update store_ai_account set auth_type = 'oauth', key_enc = ${await sealTokens(box, stale(1))}`
    const id = `store:${t.storeA1}`
    const results = await Promise.all([a().refresher(id), connectionsFor(t.storeA1, t.partnerA).refresher(id), a().refresher(id)])
    expect(refreshed).toEqual(['refresh-1'])
    expect(new Set(results.map((r) => r.secret)).size).toBe(1)
    expect(results[0]?.secret).toBe('access-101')
  })

  it('refuses another tenant\'s connection and an expired grant without leaking either', async () => {
    await putStoreKey(t.storeA1, 'x')
    await db.sql`update store_ai_account set auth_type = 'oauth', key_enc = ${await sealTokens(box, stale(1))}`
    await expect(b().refresher(`store:${t.storeA1}`)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    expect(refreshed).toEqual([])
    refreshOutcome = 'rejected'
    await expect(a().refresher(`store:${t.storeA1}`)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
  })
})

describe('secrets', () => {
  it('appear in no health record, activity row or log line', async () => {
    const lines: string[] = []
    const spy = vi.spyOn(console, 'log').mockImplementation((line: unknown) => void lines.push(String(line)))
    try {
      await putStoreKey(t.storeA1, 'sk-ant-storeA-secret-0000000')
      const id = `store:${t.storeA1}`
      await a().startCooldown(id, 30)
      await a().markValidated(id, 'rejected')
      const out = JSON.stringify([await a().health(id), await db.sql`select * from activity_log`, lines])
      expect(out).not.toContain('secret-0000000')
      expect(out).not.toMatch(/v1\.[A-Za-z0-9_-]+\./)
    } finally {
      spy.mockRestore()
    }
  })
})
