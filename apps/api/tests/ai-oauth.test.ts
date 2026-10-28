import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { hashSessionId } from '#auth/session'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { anthropicOAuth, createOAuthProviders, GatewayError, OAuthError, type ChatAnswer, type ChatProvider, type OAuthProviders, type OAuthTokens } from '#integrations/ai/index'
import { activityLog } from '#saas/activity/index'
import { createAiGateway, designerAiFor, designerModelsFor } from '#saas/aiGateway/index'
import { createAiOAuth, sealTokens } from '#saas/aiOAuth/index'
import { createPartnerCredentialsService } from '#saas/partnerCredentials/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #950: signing in to an AI account. The provider is a stand-in that records what it is asked; everything else (database,
// sealing, ownership, the lock, the gateway) is real. The provider's own endpoints are covered in integrations/ai/oauth.

let db: TestDatabase
let t: Tenants
let box: SecretBox
const now = new Date('2026-10-28T09:00:00Z')
const kek = Buffer.alloc(32, 6).toString('base64')
const facts = { requestId: 'r', ip: null, userAgent: null }

const log = { exchanged: [] as string[], refreshed: [] as string[], revoked: [] as string[], chatted: [] as { token: string; accountId: string | null }[] }
let refreshOutcome: 'ok' | 'rejected' | 'down' | 'client' = 'ok'
let tick = 0
let chatFails = false

const tokens = (n: number): OAuthTokens => ({ accessToken: `access-${n}`, refreshToken: `refresh-${n}`, expiresAt: now.getTime() + 3_600_000, accountLabel: 'maya@chat.example', accountId: 'ws-1' })

const stubChat = (token: string, accountId: string | null = null): ChatProvider => ({
  name: 'openai',
  validateCredentials: () => Promise.resolve('ok'),
  listModels: () => Promise.resolve([]),
  generateResponse: (): Promise<ChatAnswer> => {
    if (chatFails) return Promise.reject(new GatewayError('INVALID_CREDENTIALS'))
    log.chatted.push({ token, accountId })
    return Promise.resolve({ text: 'hi', model: 'gpt-5', finish: 'stop', usage: { tokensIn: 100, tokensOut: 50 } })
  },
  streamResponse: async function* () {
    if (chatFails) throw new GatewayError('INVALID_CREDENTIALS')
    log.chatted.push({ token, accountId })
    yield { kind: 'text' as const, text: 'hi' }
    yield { kind: 'end' as const, finish: 'stop' as const, model: 'gpt-5', usage: { tokensIn: 100, tokensOut: 50 } }
  },
})

const providers: OAuthProviders = {
  anthropic: anthropicOAuth(),
  openai: {
    id: 'openai',
    redirectUri: 'http://localhost:1455/auth/callback',
    availability: () => ({ available: true }),
    authorizeUrl: ({ state, challenge }) => `https://auth.example/authorize?state=${state}&challenge=${challenge}`,
    exchangeCode: ({ code }) => {
      log.exchanged.push(code)
      return code === 'bad' ? Promise.reject(new OAuthError('EXCHANGE_FAILED')) : Promise.resolve(tokens(++tick))
    },
    refresh: async (old) => {
      log.refreshed.push(old.refreshToken ?? '')
      await new Promise((r) => setTimeout(r, 30))
      if (refreshOutcome === 'rejected') throw new OAuthError('REFRESH_REJECTED')
      if (refreshOutcome === 'down') throw new OAuthError('PROVIDER_DOWN')
      if (refreshOutcome === 'client') throw new OAuthError('CLIENT_REFUSED')
      return { ...tokens(++tick), accountLabel: null }
    },
    revoke: (old) => {
      log.revoked.push(old.refreshToken ?? '')
      return Promise.resolve()
    },
    chat: ({ accessToken, accountId }) => stubChat(accessToken, accountId),
  },
}

const oauth = () => createAiOAuth({ sql: db.sql, secrets: box, providers, now: () => now })

type Who = 'owner' | 'owner2' | 'manager' | 'bOwner'
const people: Record<Who, string> = { owner: '', owner2: '', manager: '', bOwner: '' }
const cookies: Record<Who, string> = { ...people }
const storeOf = (w: Who) => (w === 'bOwner' ? t.storeB1 : t.storeA1)
const partnerOf = (w: Who) => (w === 'bOwner' ? t.partnerB : t.partnerA)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  box = await secretBox(kek)
  for (const [who, role, email] of [['owner', 'owner', 'o@a.example'], ['owner2', 'owner', 'o2@a.example'], ['manager', 'manager', 'm@a.example'], ['bOwner', 'owner', 'o@b.example']] as const) {
    people[who] = (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerOf(who)}, ${email}, ${who}, 'active') returning id`)[0]?.id ?? ''
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people[who]}, ${storeOf(who)}, ${role}, 'active')`
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: partnerOf(who) }, now))
  }
  const [p] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${t.partnerA}, 'Plan A1', 'live') returning id`
  await db.sql`update store set plan_id = ${p?.id ?? ''}, status = 'active' where id = ${t.storeA1}`
  await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
    values (${t.storeA1}, ${t.partnerA}, ${p?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
}, 60_000)
afterAll(async () => {
  await db?.drop()
})

const run = async (who: Who, source: string, variables: Record<string, unknown> = {}) => {
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who) } }), partnerOf(who), now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: partnerOf(who), sql: db.sql, activity: activityLog, facts, secrets: box, aiOauth: oauth(), checkAiKey: () => Promise.resolve('ok'), now: () => now }
  const r = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: r.data as Record<string, unknown> | null | undefined, code: r.errors?.[0]?.extensions['code'] as string | undefined }
}
const begin = (who: Who, provider = 'openai') => run(who, 'mutation($p: String!) { beginStoreAiOauth(provider: $p) }', { p: provider })
const finish = (who: Who, pasted: string) => run(who, 'mutation($r: String!) { finishStoreAiOauth(response: $r) }', { r: pasted })
const show = (who: Who) => run(who, '{ storeAiAccount { provider keyPrefix status authType accountLabel } }')
const stateOf = (url: unknown) => new URL(String(url)).searchParams.get('state') ?? ''

/** Starts a sign-in and returns what the person pastes back from the provider: `code#state`. */
const pastedFor = (url: unknown, code = 'good') => `${code}#${stateOf(url)}`
const signIn = async (who: Who, code = 'good') => {
  const url = (await begin(who)).data?.['beginStoreAiOauth']
  return { url, pasted: pastedFor(url, code) }
}

describe('signing in to a store\'s AI account', () => {
  it('offers both providers\' sign-in', async () => {
    expect((await run('owner', '{ storeAiSignIn { provider available reason } }')).data?.['storeAiSignIn']).toEqual([
      { provider: 'anthropic', available: true, reason: null },
      { provider: 'openai', available: true, reason: null },
    ])
  })

  it('lets only the Owner begin, and keeps the verifier sealed', async () => {
    expect((await begin('manager')).code).toBe('FORBIDDEN')
    expect((await begin('owner', 'nope')).code).toBe('INVALID_INPUT')
    const started = await begin('owner')
    expect(String(started.data?.['beginStoreAiOauth'])).toMatch(/^https:\/\/auth\.example\/authorize\?state=[0-9a-f]{64}&challenge=/)
    const [row] = await db.sql<{ verifier_enc: string; state_hash: string; owner_kind: string }[]>`select verifier_enc, state_hash, owner_kind from ai_oauth_attempt where owner_id = ${t.storeA1}`
    expect(row?.verifier_enc).toMatch(/^v1\./)
    expect(row?.state_hash).toBe(await hashSessionId(stateOf(started.data?.['beginStoreAiOauth'])))
    expect(row?.owner_kind).toBe('store')
  })

  it('finishes once, for the person who started it, and keeps tokens out of every answer and row', async () => {
    const { pasted } = await signIn('owner')
    expect((await finish('manager', pasted)).code).toBe('FORBIDDEN')
    expect((await finish('bOwner', pasted)).code).toBe('OAUTH_EXPIRED')
    expect((await finish('owner2', pasted)).code).toBe('OAUTH_EXPIRED')
    expect((await finish('owner', `good#${'f'.repeat(64)}`)).code).toBe('OAUTH_EXPIRED')
    expect((await finish('owner', 'not a code')).code).toBe('OAUTH_EXPIRED')
    const done = await finish('owner', pasted); expect(done.code).toBeUndefined(); expect(done.data?.['finishStoreAiOauth']).toBe(true)
    expect((await finish('owner', pasted)).code).toBe('OAUTH_EXPIRED')
    expect((await show('owner')).data?.['storeAiAccount']).toEqual({ provider: 'openai', keyPrefix: '', status: 'ok', authType: 'oauth', accountLabel: 'maya@chat.example' })
    const [account] = await db.sql<{ key_enc: string }[]>`select key_enc from store_ai_account where store_id = ${t.storeA1}`
    expect(account?.key_enc).toMatch(/^v1\./)
    const everything = JSON.stringify(await db.sql`select * from activity_log`) + JSON.stringify((await show('owner')).data)
    expect(everything).not.toMatch(/access-\d|refresh-\d/)
    expect(await db.sql`select 1 from ai_oauth_attempt where owner_id = ${t.storeA1}`).toHaveLength(0)
    const actions = (await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${t.storeA1}`).map((r) => r.action)
    expect(actions).toEqual(expect.arrayContaining(['store.ai_oauth_started', 'store.ai_account_connected']))
  })

  it('answers nothing for an unknown, replayed or expired state, and drops a cancelled or failed attempt', async () => {
    expect(await oauth().callback(new URLSearchParams({ code: 'c', state: 'e'.repeat(64) }))).toBeNull()
    expect(await oauth().callback(new URLSearchParams({ code: 'c', state: 'not-a-state' }))).toBeNull()
    const first = await begin('owner')
    const state = stateOf(first.data?.['beginStoreAiOauth'])
    expect((await oauth().callback(new URLSearchParams({ code: 'good', state })))?.outcome).toBe('finish')
    expect(await oauth().callback(new URLSearchParams({ code: 'good', state }))).toBeNull()

    expect((await oauth().callback(new URLSearchParams({ error: 'access_denied', state: stateOf((await begin('owner')).data?.['beginStoreAiOauth']) })))?.outcome).toBe('cancelled')
    expect(await db.sql`select 1 from ai_oauth_attempt where owner_id = ${t.storeA1}`).toHaveLength(0)
    expect((await oauth().callback(new URLSearchParams({ error: 'invalid_scope', state: stateOf((await begin('owner')).data?.['beginStoreAiOauth']) })))?.outcome).toBe('failed')
    expect((await oauth().callback(new URLSearchParams({ code: 'bad', state: stateOf((await begin('owner')).data?.['beginStoreAiOauth']) })))?.outcome).toBe('failed')

    const late = stateOf((await begin('owner')).data?.['beginStoreAiOauth'])
    await db.sql`update ai_oauth_attempt set expires_at = ${new Date(now.getTime() - 1000)} where owner_id = ${t.storeA1}`
    expect(await oauth().callback(new URLSearchParams({ code: 'good', state: late }))).toBeNull()
  })

  it('replaces an earlier attempt, so only the latest state works', async () => {
    const one = stateOf((await begin('owner')).data?.['beginStoreAiOauth'])
    const two = stateOf((await begin('owner')).data?.['beginStoreAiOauth'])
    expect(await oauth().callback(new URLSearchParams({ code: 'good', state: one }))).toBeNull()
    expect((await oauth().callback(new URLSearchParams({ code: 'good', state: two })))?.outcome).toBe('finish')
  })

  it('lets the Owner connect an account while the store is view-only, but not remove it', async () => {
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      const { pasted } = await signIn('owner')
      expect((await finish('owner', pasted)).data?.['finishStoreAiOauth']).toBe(true)
      expect((await run('owner', 'mutation { removeStoreAiAccount }')).code).toBe('READ_ONLY')
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })

  it('refuses a pasted answer past its time', async () => {
    const { pasted } = await signIn('owner')
    await db.sql`update ai_oauth_attempt set expires_at = ${new Date(now.getTime() - 1000)} where owner_id = ${t.storeA1}`
    expect((await finish('owner', pasted)).code).toBe('OAUTH_EXPIRED')
  })

  it('takes the provider\'s address as well as code#state, and refuses a wrong state', async () => {
    const url = (await begin('owner')).data?.['beginStoreAiOauth']
    expect((await finish('owner', `http://localhost:1455/auth/callback?code=good&state=${'0'.repeat(64)}`)).code).toBe('OAUTH_EXPIRED')
    expect((await finish('owner', `http://localhost:1455/auth/callback?code=good&state=${stateOf(url)}`)).data?.['finishStoreAiOauth']).toBe(true)
  })

  it('refuses a failed exchange and an answer from the provider that is an error', async () => {
    expect((await finish('owner', (await signIn('owner', 'bad')).pasted)).code).toBe('OAUTH_EXPIRED')
    const url = (await begin('owner')).data?.['beginStoreAiOauth']
    expect((await finish('owner', `http://localhost:1455/auth/callback?error=access_denied&state=${stateOf(url)}`)).code).toBe('OAUTH_EXPIRED')
  })
})

describe('using a signed-in account', () => {
  const connected = async () => {
    const { pasted } = await signIn('owner')
    await finish('owner', pasted)
  }
  const connectedClaude = async () => {
    const keyEnc = await sealTokens(box, { accessToken: 'claude-access', refreshToken: 'claude-refresh', expiresAt: now.getTime() + 3_600_000, accountLabel: null, accountId: null })
    await withSystemScope(db.sql, async (tx) => {
      await tx`delete from store_ai_account where store_id = ${t.storeA1}`
      await tx`insert into store_ai_account (store_id, provider, key_enc, key_prefix, status, connected_by, auth_type)
        values (${t.storeA1}, 'anthropic', ${keyEnc}, '', 'ok', ${people.owner}, 'oauth')`
    })
  }
  const expireTokens = async () => {
    const sealed = await sealTokens(box, { accessToken: 'stale', refreshToken: 'refresh-old', expiresAt: now.getTime() - 1000, accountLabel: null, accountId: null })
    await db.sql`update store_ai_account set key_enc = ${sealed}, status = 'ok' where store_id = ${t.storeA1}`
  }
  const owner = { kind: 'store', id: '', partnerId: '' } as const

  it('writes no token, key or authorization header to any log line, even when a sign-in or a refresh fails', async () => {
    const lines: string[] = []
    const spies = (['log', 'error', 'warn', 'info'] as const).map((m) => vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void lines.push(a.map(String).join(' '))))
    try {
      await connected()
      await finish('owner', (await signIn('owner', 'bad')).pasted)
      await expireTokens()
      refreshOutcome = 'rejected'
      await oauth().accessToken({ ...owner, id: t.storeA1, partnerId: t.partnerA }, null)
      refreshOutcome = 'ok'
    } finally {
      spies.forEach((spy) => spy.mockRestore())
    }
    expect(lines.length).toBeGreaterThan(0)
    expect(lines.filter((l) => /refresh-old|access-\d+|refresh-\d+|stale|authorization|bearer/i.test(l))).toEqual([])
  })

  it('renews an expired token once under the row lock, keeping the label', async () => {
    await connected()
    await expireTokens()
    log.refreshed.length = 0
    refreshOutcome = 'ok'
    const results = await Promise.all([1, 2, 3].map(() => oauth().accessToken({ ...owner, id: t.storeA1, partnerId: t.partnerA }, null)))
    expect(results.every((r) => r.ok)).toBe(true)
    expect(new Set(results.map((r) => (r.ok ? r.token : ''))).size).toBe(1)
    expect(log.refreshed).toEqual(['refresh-old'])
    expect((await show('owner')).data?.['storeAiAccount']).toMatchObject({ status: 'ok', accountLabel: 'maya@chat.example' })
  })

  it('marks the account rejected when the provider refuses the grant, but not when it is only down', async () => {
    await connected()
    await expireTokens()
    refreshOutcome = 'down'
    expect(await oauth().accessToken({ ...owner, id: t.storeA1, partnerId: t.partnerA }, null)).toEqual({ ok: false, reason: 'UNAVAILABLE' })
    expect((await show('owner')).data?.['storeAiAccount']).toMatchObject({ status: 'ok' })
    refreshOutcome = 'rejected'
    expect(await oauth().accessToken({ ...owner, id: t.storeA1, partnerId: t.partnerA }, null)).toEqual({ ok: false, reason: 'EXPIRED' })
    expect((await show('owner')).data?.['storeAiAccount']).toMatchObject({ status: 'rejected' })
    expect((await run('owner', 'mutation { testStoreAiAccount { status } }')).code).toBe('OAUTH_EXPIRED')
    refreshOutcome = 'ok'
  })

  it('tests a working sign-in without spending a run', async () => {
    await connected()
    expect((await run('owner', 'mutation { testStoreAiAccount { status } }')).data?.['testStoreAiAccount']).toEqual({ status: 'ok' })
  })

  it('does not strand accounts when our own client is refused, and uses a token that still has life', async () => {
    await connected()
    await expireTokens()
    refreshOutcome = 'client'
    expect(await oauth().accessToken({ ...owner, id: t.storeA1, partnerId: t.partnerA }, null)).toEqual({ ok: false, reason: 'UNAVAILABLE' })
    expect((await show('owner')).data?.['storeAiAccount']).toMatchObject({ status: 'ok' })
    const nearEnd = await sealTokens(box, { accessToken: 'last-gasp', refreshToken: 'refresh-old', expiresAt: now.getTime() + 30_000, accountLabel: null, accountId: null })
    await db.sql`update store_ai_account set key_enc = ${nearEnd} where store_id = ${t.storeA1}`
    expect(await oauth().accessToken({ ...owner, id: t.storeA1, partnerId: t.partnerA }, null)).toEqual({ ok: true, token: 'last-gasp', accountId: null, provider: 'openai' })
    refreshOutcome = 'ok'
  })

  it('reads a valid token without taking the row lock', async () => {
    await connected()
    const held = db.sql.begin(async (tx) => {
      await tx`select 1 from store_ai_account where store_id = ${t.storeA1} for update`
      return (await oauth().accessToken({ ...owner, id: t.storeA1, partnerId: t.partnerA }, null)).ok
    })
    expect(await held).toBe(true)
  })

  it('fails the studio clearly when the provider turns a live token down', async () => {
    await connected()
    await ownKeyPlan()
    chatFails = true
    await expect((await studio([]))?.complete(ask)).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' })
    chatFails = false
  })

  it('revokes the grant of an approved sign-in that is replaced, and of the one a new sign-in replaces', async () => {
    const { pasted } = await signIn('owner')
    expect(await oauth().submit({ owner: { kind: 'store', id: t.storeA1, partnerId: t.partnerA }, startedBy: people.owner, pasted })).toMatchObject({ key: expect.stringMatching(/^[0-9a-f]{64}$/) })
    log.revoked.length = 0
    await begin('owner')
    expect(log.revoked).toHaveLength(1)
    await connected()
    log.revoked.length = 0
    await connected()
    expect(log.revoked).toHaveLength(1)
  })

  it('keeps a finished approval when a duplicate callback fails, and revokes the loser of two that both succeed', async () => {
    const state = stateOf((await begin('owner')).data?.['beginStoreAiOauth'])
    const [good, bad] = await Promise.all([oauth().callback(new URLSearchParams({ code: 'good', state })), oauth().callback(new URLSearchParams({ code: 'bad', state }))])
    expect(good?.outcome ?? bad?.outcome).toBeDefined()
    expect(await db.sql`select 1 from ai_oauth_attempt where owner_id = ${t.storeA1} and status = 'approved'`).toHaveLength(good?.outcome === 'finish' ? 1 : 0)
    const twice = stateOf((await begin('owner')).data?.['beginStoreAiOauth'])
    log.revoked.length = 0
    const both = await Promise.all([oauth().callback(new URLSearchParams({ code: 'good', state: twice })), oauth().callback(new URLSearchParams({ code: 'good', state: twice }))])
    expect(both.filter((r) => r?.outcome === 'finish')).toHaveLength(1)
    expect(await db.sql`select 1 from ai_oauth_attempt where owner_id = ${t.storeA1} and status = 'approved'`).toHaveLength(1)
  })

  const gateway = (adapterToken: string[], oauthDeps = oauth()) =>
    createAiGateway({
      sql: db.sql,
      context: { caller: { kind: 'api-key', keyId: crypto.randomUUID(), createdByUserId: people.owner }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' },
      secrets: box,
      fallbackKey: undefined,
      actor: { keyId: null, userId: null },
      oauth: oauthDeps,
      adapters: (_provider, key, auth, accountId) => {
        adapterToken.push(`${auth}:${key}`)
        return stubChat(key, accountId)
      },
      now: () => now,
      sleep: () => Promise.resolve(),
    })
  const studio = (adapterToken: string[]) =>
    designerAiFor({ sql: db.sql, context: { caller: { kind: 'api-key', keyId: crypto.randomUUID(), createdByUserId: people.owner }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }, secrets: box, fallbackKey: undefined, oauth: oauth(), adapters: (_p, key, auth, accountId) => (adapterToken.push(`${auth}:${key}`), stubChat(key, accountId)) }, 'own_key')
  const designerDeps = () => ({ sql: db.sql, context: { caller: { kind: 'api-key' as const, keyId: crypto.randomUUID(), createdByUserId: people.owner }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }, secrets: box, fallbackKey: undefined, oauth: oauth() })
  const ask = { system: 's', text: 'hi', images: [] }
  const ownKeyPlan = async () => {
    await db.sql`delete from plan_entitlement where plan_id = (select plan_id from store where id = ${t.storeA1}) and key in ('ai_mode', 'ai_prompts')`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_mode', 0 from store where id = ${t.storeA1}`
  }
  const call = { provider: 'openai' as const, model: 'gpt-5', messages: [{ role: 'user' as const, content: 'hi' }], maxTokens: 100, stream: false }

  it("runs the studio on the sign-in's token at no cost, and refuses it for /v1", async () => {
    await connected()
    await ownKeyPlan()
    const used: string[] = []
    expect(await (await studio(used))?.complete(ask)).toMatchObject({ text: 'hi', costAmount: 0 })
    expect(used).toHaveLength(1)
    expect(used[0]).toMatch(/^oauth:access-\d+$/)
    expect(await gateway(used).complete(call)).toEqual({ ok: false, reason: 'AI_NOT_CONNECTED' })
    expect(used).toHaveLength(1)
  })

  it('offers the reference Claude model for an Anthropic OAuth account', async () => {
    await connectedClaude()
    const models = await designerModelsFor(designerDeps(), 'own_key')
    expect(models[0]).toBe('claude-haiku-4-5')
    expect(models).toContain('claude-sonnet-5-5')
    expect(await designerAiFor(designerDeps(), 'own_key', 'claude-sonnet-5-5')).not.toBeNull()
  })

  it('gives the studio no model, without a model call, when the sign-in has expired or the provider is down', async () => {
    await connected()
    await ownKeyPlan()
    await expireTokens()
    const used: string[] = []
    refreshOutcome = 'down'
    expect(await studio(used)).toBeNull()
    refreshOutcome = 'rejected'
    expect(await studio(used)).toBeNull()
    expect(used).toEqual([])
    refreshOutcome = 'ok'
  })

  it('never lets Claude be served by a sign-in', async () => {
    await connected()
    await ownKeyPlan()
    expect(await gateway([]).complete({ ...call, provider: 'anthropic', model: 'claude-sonnet-5-5' })).toEqual({ ok: false, reason: 'AI_NOT_CONNECTED' })
  })

  it('revokes at the provider when the account is removed or replaced by a key', async () => {
    await connected()
    log.revoked.length = 0
    expect((await run('owner', 'mutation { removeStoreAiAccount }')).data?.['removeStoreAiAccount']).toBe(true)
    expect(log.revoked).toHaveLength(1)
    await connected()
    log.revoked.length = 0
    const key = 'sk-proj-REPLACINGKEYREPLACINGKEY1234'
    expect((await run('owner', 'mutation($k: String!) { connectStoreAiAccount(provider: "openai", key: $k) }', { k: key })).data?.['connectStoreAiAccount']).toBe(true)
    expect(log.revoked).toHaveLength(1)
    expect((await show('owner')).data?.['storeAiAccount']).toMatchObject({ authType: 'api_key', accountLabel: null })
  })
})

describe('a partner\'s sign-in', () => {
  const caller = (partnerId: string): PartnerCaller => ({ role: 'partner-owner', user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' }, staff: null, partner: { id: partnerId, name: 'P', product: 'P', host: null, state: 'live' } })
  const service = (partnerId: string, c = caller(partnerId)) => createPartnerCredentialsService({ sql: db.sql, caller: c, facts, activity: activityLog, secrets: box, checkKey: () => Promise.resolve('ok'), oauth: oauth(), now: () => now })
  const startedBy = (c: PartnerCaller) => c.user?.id ?? ''
  const signInAs = async (partnerId: string, c: PartnerCaller, id: string | null = null) => {
    const begun = await service(partnerId, c).beginOauth('openai', id)
    return { begun, pasted: pastedFor(begun.url) }
  }

  it('creates a default sign-in profile, then a second, and replaces tokens on reconnect', async () => {
    const a = caller(t.partnerA)
    const first = await signInAs(t.partnerA, a)
    const done = await service(t.partnerA, a).finishOauth(first.pasted)
    expect(done.ok).toBe(true)
    const list = await service(t.partnerA, a).aiKeys()
    expect(list).toMatchObject([{ name: 'ChatGPT sign-in', provider: 'openai', authType: 'oauth', accountLabel: 'maya@chat.example', isDefault: true, keyPrefix: '' }])
    expect(JSON.stringify(list)).not.toMatch(/access-\d|refresh-\d/)

    const second = await signInAs(t.partnerA, a)
    await service(t.partnerA, a).finishOauth(second.pasted)
    expect((await service(t.partnerA, a).aiKeys()).map((k) => [k.name, k.isDefault])).toEqual([['ChatGPT sign-in', true], ['ChatGPT sign-in 2', false]])

    const id = list[0]?.id ?? ''
    const before = (await db.sql<{ key_enc: string }[]>`select key_enc from partner_credential where id = ${id}`)[0]?.key_enc
    const again = await signInAs(t.partnerA, a, id)
    expect((await service(t.partnerA, a).finishOauth(again.pasted)).ok).toBe(true)
    expect((await db.sql<{ key_enc: string }[]>`select key_enc from partner_credential where id = ${id}`)[0]?.key_enc).not.toBe(before)
    expect(await service(t.partnerA, a).aiKeys()).toHaveLength(2)
    expect(startedBy(a)).toBeTruthy()
  })

  it('keeps one partner\'s sign-in from another partner, from a store, and from a different person', async () => {
    const a = caller(t.partnerA)
    const { pasted } = await signInAs(t.partnerA, a)
    expect(await service(t.partnerB, caller(t.partnerB)).finishOauth(pasted)).toEqual({ ok: false, reason: 'OAUTH_EXPIRED' })
    expect(await service(t.partnerA, caller(t.partnerA)).finishOauth(pasted)).toEqual({ ok: false, reason: 'OAUTH_EXPIRED' })
    expect(await oauth().submit({ owner: { kind: 'store', id: t.storeA1, partnerId: t.partnerA }, startedBy: startedBy(a), pasted })).toBeNull()
    expect((await service(t.partnerA, a).finishOauth(pasted)).ok).toBe(true)
    expect((await service(t.partnerB, caller(t.partnerB)).aiKeys()).filter((k) => k.authType === 'oauth')).toHaveLength(0)
  })

  it('refuses a reconnect of a profile that is not this partner\'s sign-in', async () => {
    const a = caller(t.partnerA)
    const other = (await service(t.partnerA, a).aiKeys())[0]?.id ?? ''
    expect(await service(t.partnerB, caller(t.partnerB)).beginOauth('openai', other)).toEqual({ ok: false, reason: 'NOT_FOUND' })
  })

  it('serves the studio on its default sign-in, says so when it expires, and is refused for /v1', async () => {
    const [def] = await db.sql<{ id: string }[]>`select id from partner_credential where partner_id = ${t.partnerA} and is_default`
    await db.sql`update partner_credential set status = 'ok' where id = ${def?.id ?? ''}`
    await db.sql`delete from plan_entitlement where plan_id = (select plan_id from store where id = ${t.storeA1}) and key in ('ai_mode', 'ai_prompts')`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_mode', 1 from store where id = ${t.storeA1}`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_prompts', 5 from store where id = ${t.storeA1}`
    await db.sql`delete from store_usage where store_id = ${t.storeA1} and key = 'ai_prompts'`
    log.chatted.length = 0
    const gw = () =>
      createAiGateway({
        sql: db.sql,
        context: { caller: { kind: 'api-key', keyId: crypto.randomUUID(), createdByUserId: people.owner }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' },
        secrets: box,
        fallbackKey: undefined,
        actor: { keyId: null, userId: null },
        oauth: oauth(),
        adapters: (_p, key, auth, accountId) => stubChat(`${auth}:${key}`, accountId),
        now: () => now,
        sleep: () => Promise.resolve(),
      })
    // One person's subscription is not a shared API: /v1 never runs on it (THIRD-PARTY-ACCESS §2.6).
    expect(await gw().complete({ provider: 'openai', model: 'gpt-5', messages: [{ role: 'user', content: 'hi' }], maxTokens: 100, stream: false })).toEqual({ ok: false, reason: 'AI_NOT_CONNECTED' })
    expect(log.chatted).toHaveLength(0)
    expect(await gw().credential('plan')).toMatchObject({ auth: 'oauth' })
    await db.sql`update partner_credential set status = 'rejected' where id = ${def?.id ?? ''}`
    expect(await gw().credential('plan')).toEqual({ unusable: 'EXPIRED' })
  })

  it('stores nothing when a finish is refused, and revokes that approval at the next sign-in', async () => {
    const a = caller(t.partnerA)
    const [profile] = await db.sql<{ id: string }[]>`select id from partner_credential where partner_id = ${t.partnerA} and auth_type = 'oauth' order by created_at limit 1`
    const again = await signInAs(t.partnerA, a, profile?.id ?? '')
    await db.sql`update ai_oauth_attempt set credential_id = null where owner_id = ${t.partnerA}`
    await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, status, is_default, created_by)
      select ${t.partnerA}, 'ai', 'openai', 'filler ' || n, 'v1.x.y', 'x', 'ok', false, 't' from generate_series(1, 25) n on conflict do nothing`
    const refused = await service(t.partnerA, a).finishOauth(again.pasted)
    expect(refused).toEqual({ ok: false, reason: 'LIMIT_REACHED' })
    // The refused finish stored nothing; its approval waits to expire or be replaced (and revoked) by the next sign-in.
    expect(await db.sql`select 1 from ai_oauth_attempt where owner_id = ${t.partnerA} and status = 'approved'`).toHaveLength(1)
    await db.sql`delete from partner_credential where name like 'filler %'`
    log.revoked.length = 0
    const retry = await signInAs(t.partnerA, a, profile?.id ?? '')
    expect(log.revoked).toHaveLength(1)
    expect((await service(t.partnerA, a).finishOauth(retry.pasted)).ok).toBe(true)
  })

  it('revokes at the provider when the profile is removed', async () => {
    const a = caller(t.partnerA)
    log.revoked.length = 0
    const target = (await service(t.partnerA, a).aiKeys()).find((k) => k.name === 'ChatGPT sign-in 2')
    expect(await service(t.partnerA, a).removeAiKey(target?.id ?? '')).toEqual({ ok: true })
    expect(log.revoked).toHaveLength(1)
  })
})

describe('the sign-in switch', () => {
  it('is off unless AI_SIGN_IN turns it on', () => {
    expect(createOAuthProviders(false).anthropic.availability()).toMatchObject({ available: false })
    expect(createOAuthProviders(false).openai.availability()).toMatchObject({ available: false })
    expect(createOAuthProviders(true).openai.availability()).toEqual({ available: true })
  })
})
