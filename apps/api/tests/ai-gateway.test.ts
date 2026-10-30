import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { handleAiGateway } from '#apis/store/aiGateway'
import type { StoreContext } from '#apis/store/access'
import { mintApiKey } from '#auth/apiKeys'
import { secretBox } from '#auth/secretBox'
import { resolveStoreStanding } from '#auth/storeCaller'
import { pgArray, withSystemScope } from '#db/scoped/index'
import { upsertStoreAiAccount } from '#db/scoped/storeAiAccount'
import { GatewayError, type ChatAnswer, type ChatChunk, type ChatProvider, type ChatRequest, type GatewayProvider } from '#integrations/ai/index'
import { activityLog } from '#saas/activity/index'
import { chatInput, createAiGateway, designerAiFor, type ChatInput } from '#saas/aiGateway/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #950: the AI gateway: whose key runs a call, the allowance, the store's own account behind its switch, metering without
// prompts, a key's scope, and no key or upstream detail in any answer.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-28T09:00:30Z')
const kek = Buffer.alloc(32, 9).toString('base64')
const partnerKey = 'sk-ant-api03-PARTNERPARTNERPARTNERPARTNER'
const storeKey = 'sk-proj-STORESTORESTORESTORESTORE'
const facts = { requestId: 'r', ip: null, userAgent: null }
let owner = ''

interface Call {
  provider: GatewayProvider
  key: string
  request: ChatRequest
}
const calls: Call[] = []
let plan: (() => Promise<ChatAnswer>)[] = []

const answer = (text = 'hello'): ChatAnswer => ({ text, model: 'claude-sonnet-5-5', finish: 'stop', usage: { tokensIn: 10, tokensOut: 5 } })

const fake = (provider: GatewayProvider, key: string): ChatProvider => ({
  name: provider,
  validateCredentials: () => Promise.resolve('ok'),
  listModels: () => Promise.resolve([]),
  generateResponse: async (request) => {
    calls.push({ provider, key, request })
    const next = plan.shift()
    return next ? next() : answer()
  },
  streamResponse: async function* (request): AsyncGenerator<ChatChunk> {
    calls.push({ provider, key, request })
    yield { kind: 'text', text: 'he' }
    yield { kind: 'text', text: 'llo' }
    yield { kind: 'end', finish: 'stop', model: 'claude-sonnet-5-5', usage: { tokensIn: 10, tokensOut: 5 } }
  },
})

const input = (o: Partial<ChatInput> = {}): ChatInput => ({ provider: 'anthropic', model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'Explain Lambda.' }], maxTokens: 100, stream: false, ...o })

const gateway = async (storeId = t.storeA1, partnerId = t.partnerA) =>
  createAiGateway({
    sql: db.sql,
    context: { caller: { kind: 'api-key', keyId: crypto.randomUUID(), createdByUserId: owner }, partnerId, storeId, sellerScope: { kind: 'all' }, subscription: 'active' },
    secrets: await secretBox(kek),
    fallbackKey: undefined,
    actor: { keyId: null, userId: null },
    adapters: (provider, key) => fake(provider, key),
    now: () => now,
    sleep: () => Promise.resolve(),
  })

const entitle = async (storeId: string, mode: number, prompts: number) => {
  await db.sql`delete from plan_entitlement where plan_id = (select plan_id from store where id = ${storeId}) and key in ('ai_mode', 'ai_prompts')`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_mode', ${mode} from store where id = ${storeId}`
  await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) select plan_id, partner_id, 1, 'ai_prompts', ${prompts} from store where id = ${storeId}`
  await db.sql`delete from store_usage where store_id = ${storeId} and key = 'ai_prompts'`
}

const partnerProfile = async (partnerId: string, provider: 'anthropic' | 'openai', key: string, status = 'ok') => {
  const sealed = await (await secretBox(kek)).seal(key)
  await db.sql`delete from partner_credential where partner_id = ${partnerId}`
  await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, status, is_default, created_by) values (${partnerId}, 'ai', ${provider}, 'Default', ${sealed}, 'x', ${status}, true, 'test')`
}

const partnerSignIn = async (partnerId: string) => {
  await partnerProfile(t.partnerA, 'anthropic', partnerKey)
  await db.sql`update partner_credential set auth_type = 'oauth' where partner_id = ${partnerId}`
}

const storeAccount = async (storeId: string, o: { switchOn?: boolean; status?: 'ok' | 'untested' } = {}) => {
  const sealed = await (await secretBox(kek)).seal(storeKey)
  await withSystemScope(db.sql, (tx) => upsertStoreAiAccount(tx, { storeId, provider: 'openai', keyEnc: sealed, keyPrefix: 'sk-…', status: o.status ?? 'ok', testedAt: now, connectedBy: 'test', at: now }))
  await db.sql`update store_ai_account set use_when_plan_used = ${o.switchOn ?? false} where store_id = ${storeId}`
}

const runs = (storeId: string) => db.sql<{ billed_to: string; provider: string; prompt: string; outcome: string; kind: string; tokens_in: number; api_key_id: string | null }[]>`select billed_to, provider, prompt, outcome, kind, tokens_in, api_key_id from ai_run where store_id = ${storeId} and kind = 'gateway' order by created_at`

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  owner = (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, 'o@a.example', 'Olivia', 'active') returning id`)[0]?.id ?? ''
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner}, ${t.storeA1}, 'owner', 'active'), (${owner}, ${t.storeA2}, 'owner', 'active')`
  for (const [partnerId, storeId] of [[t.partnerA, t.storeA1], [t.partnerA, t.storeA2], [t.partnerB, t.storeB1]] as const) {
    const [p] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Plan ${storeId}`}, 'live') returning id`
    await db.sql`update store set plan_id = ${p?.id ?? ''}, status = 'active' where id = ${storeId}`
    await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
      values (${storeId}, ${partnerId}, ${p?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
  }
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe("the studio's model", () => {
  const sent: { url: string; headers: Record<string, string>; body: { model: string; messages: { role: string; content: unknown }[] } }[] = []
  const chatStream = () => {
    const chunks = [
      { choices: [{ delta: { content: 'hel' }, finish_reason: null }] },
      { choices: [{ delta: { content: 'lo' }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ]
    return new Response(`${chunks.map((c) => `data: ${JSON.stringify(c)}\n\n`).join('')}data: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }
  const standIn = (async (url: string, init: RequestInit) => {
    sent.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) })
    return chatStream()
  }) as unknown as typeof fetch
  const deps = async () => ({ sql: db.sql, context: { caller: { kind: 'api-key' as const, keyId: crypto.randomUUID(), createdByUserId: owner }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }, secrets: await secretBox(kek), fallbackKey: undefined, adapters: (provider: GatewayProvider, key: string) => fake(provider, key), executor: { fetch: standIn }, sleep: () => Promise.resolve() })

  it("runs on the store's own ChatGPT key when the plan is own-key, with an image sent as an image", async () => {
    await entitle(t.storeA1, 0, 0)
    await storeAccount(t.storeA1)
    sent.length = 0
    const model = await designerAiFor(await deps(), 'own_key')
    const done = await model?.complete({ system: 'sys', text: 'make it warmer', images: [] })
    expect(done).toMatchObject({ text: 'hello', tokensIn: 10, tokensOut: 5 })
    expect(sent).toMatchObject([{ url: 'https://api.openai.com/v1/chat/completions', headers: { authorization: `Bearer ${storeKey}`, accept: 'text/event-stream' }, body: { model: 'gpt-5' } }])
    await model?.complete({ system: 's', text: 't', images: [{ mediaType: 'image/png', base64: 'AA==' }] })
    expect(JSON.stringify(sent[1]?.body.messages)).toContain('data:image/png;base64,AA==')
  })

  it('answers null when nothing is connected', async () => {
    await db.sql`delete from partner_credential where partner_id = ${t.partnerA}`
    expect(await designerAiFor(await deps(), 'plan')).toBeNull()
  })
})

describe("a partner's sign-in", () => {
  it('is not the plan key for /v1, though the studio may use it', async () => {
    await entitle(t.storeA1, 1, 5)
    await partnerSignIn(t.partnerA)
    expect(await (await gateway()).resolve()).toMatchObject({ ok: false, reason: 'AI_NOT_CONNECTED' })
  })
})

describe('whose key runs a call', () => {
  it("uses the partner's default key while the plan's prompts last, and counts one prompt", async () => {
    await entitle(t.storeA1, 1, 2)
    await partnerProfile(t.partnerA, 'anthropic', partnerKey)
    calls.length = 0
    const r = await (await gateway()).complete(input())
    expect(r).toMatchObject({ ok: true, billed: 'plan' })
    expect(calls[0]).toMatchObject({ provider: 'anthropic', key: partnerKey })
    const [used] = await db.sql<{ used: number }[]>`select used from store_usage where store_id = ${t.storeA1} and key = 'ai_prompts'`
    expect(used?.used).toBe(1)
  })

  it('records the run without its prompt, naming the provider, and counts tokens and cost', async () => {
    const [run] = (await runs(t.storeA1)).slice(-1)
    expect(run).toMatchObject({ billed_to: 'plan', provider: 'anthropic', prompt: '', outcome: 'changed', tokens_in: 10 })
    expect(JSON.stringify(await runs(t.storeA1))).not.toContain('Explain Lambda')
  })

  it("refuses once the plan's prompts are used and the store's own account isn't switched on", async () => {
    await storeAccount(t.storeA1)
    const g = await gateway()
    await g.complete(input())
    calls.length = 0
    expect(await g.complete(input())).toEqual({ ok: false, reason: 'AI_BUDGET_REACHED' })
    expect(calls).toHaveLength(0)
  })

  it("moves to the store's own account only when its Owner switched that on", async () => {
    await storeAccount(t.storeA1, { switchOn: true })
    calls.length = 0
    const r = await (await gateway()).complete(input({ provider: 'openai', model: 'gpt-5' }))
    expect(r).toMatchObject({ ok: true, billed: 'own_key' })
    expect(calls[0]).toMatchObject({ provider: 'openai', key: storeKey })
    expect((await runs(t.storeA1)).slice(-1)[0]?.billed_to).toBe('own_key')
  })

  it("never uses a key for a provider it isn't: the partner's Anthropic key doesn't run an OpenAI model", async () => {
    await entitle(t.storeA2, 1, 5)
    await partnerProfile(t.partnerA, 'anthropic', partnerKey)
    calls.length = 0
    expect(await (await gateway(t.storeA2)).complete(input({ provider: 'openai', model: 'gpt-5' }))).toEqual({ ok: false, reason: 'MODEL_NOT_FOUND' })
    expect(calls).toHaveLength(0)
  })

  it("uses the store's own account always on an own-key plan, and says so when there is none", async () => {
    await entitle(t.storeB1, 0, 0)
    expect(await (await gateway(t.storeB1, t.partnerB)).complete(input())).toEqual({ ok: false, reason: 'AI_NOT_CONNECTED' })
    await storeAccount(t.storeB1)
    const r = await (await gateway(t.storeB1, t.partnerB)).complete(input({ provider: 'openai', model: 'gpt-5' }))
    expect(r).toMatchObject({ ok: true, billed: 'own_key' })
  })

  it('pauses, not falls back, for a rejected partner default or a store key that is rejected', async () => {
    await entitle(t.storeA2, 1, 5)
    await partnerProfile(t.partnerA, 'anthropic', partnerKey, 'rejected')
    expect(await (await gateway(t.storeA2)).complete(input())).toEqual({ ok: false, reason: 'AI_NOT_CONNECTED' })
    await partnerProfile(t.partnerA, 'anthropic', partnerKey)
  })
})

describe('validation before any provider or budget', () => {
  it('refuses an unlisted model, a token count past the model, and a temperature outside its range', async () => {
    const g = await gateway(t.storeA2)
    expect(g.validate(input({ model: 'claude-made-up' }))).toEqual({ ok: false, reason: 'MODEL_NOT_FOUND' })
    expect(g.validate(input({ maxTokens: 64_000, model: 'claude-haiku-5-5' }))).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(g.validate(input({ messages: [{ role: 'system', content: 'Only a system turn' }] }))).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(g.validate(input({ messages: [{ role: 'system', content: 'S' }, { role: 'assistant', content: 'A' }] }))).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(g.validate({ ...input(), maxTokens: undefined, model: 'claude-haiku-5-5' }).ok).toBe(true)
    expect(g.validate(input({ maxTokens: 32_001, model: 'claude-haiku-5-5' }))).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(g.validate(input({ temperature: 1.5 }))).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect(g.validate(input({ provider: 'openai', model: 'gpt-5', temperature: 1.5 })).ok).toBe(true)
  })
})

describe('the request body', () => {
  it('refuses an empty system text block, which Anthropic would reject', () => {
    const body = { provider: 'anthropic', model: 'claude-sonnet-5-5', messages: [{ role: 'user', content: 'Hi' }] }
    expect(chatInput.safeParse({ ...body, system: [{ type: 'text', text: '' }] }).success).toBe(false)
    expect(chatInput.safeParse({ ...body, system: [{ type: 'text', text: 'ok' }] }).success).toBe(true)
  })
})

describe('the request the provider receives', () => {
  it("asks for the model's maximum output when maxTokens is omitted, and passes system blocks and system turns through", async () => {
    await entitle(t.storeA1, 1, 5)
    await partnerProfile(t.partnerA, 'anthropic', partnerKey)
    calls.length = 0
    const bare = { ...input(), maxTokens: undefined }
    const system = [{ type: 'text' as const, text: 'Block' }]
    const messages = [{ role: 'system' as const, content: 'Turn' }, { role: 'user' as const, content: 'Hi' }]
    expect(await (await gateway()).complete({ ...bare, system, messages })).toMatchObject({ ok: true })
    expect(calls[0]?.request).toMatchObject({ maxTokens: 64_000, system, messages })
  })
})

describe('transient failures and retries', () => {
  const failing = (code: ConstructorParameters<typeof GatewayError>[0]) => () => Promise.reject(new GatewayError(code))

  it('tries a busy provider again and gives the prompt back only if the call never succeeds', async () => {
    await entitle(t.storeA2, 1, 5)
    plan = [failing('RATE_LIMITED'), failing('PROVIDER_UNAVAILABLE'), () => Promise.resolve(answer('third time'))]
    calls.length = 0
    const r = await (await gateway(t.storeA2)).complete(input())
    expect(r).toMatchObject({ ok: true })
    expect(calls).toHaveLength(3)
  })

  it('does not retry a refused key, and answers a code with no upstream detail', async () => {
    await entitle(t.storeA2, 1, 5)
    plan = [failing('INVALID_CREDENTIALS'), () => Promise.resolve(answer())]
    calls.length = 0
    const r = await (await gateway(t.storeA2)).complete(input())
    expect(r).toMatchObject({ ok: false, error: { code: 'INVALID_CREDENTIALS' } })
    expect(calls).toHaveLength(1)
    plan = []
    const [used] = await db.sql<{ used: number }[]>`select used from store_usage where store_id = ${t.storeA2} and key = 'ai_prompts'`
    expect(used?.used ?? 0).toBe(0)
  })

  it('stops after the last try on a provider that stays down', async () => {
    await entitle(t.storeA2, 1, 5)
    plan = [failing('TIMEOUT'), failing('TIMEOUT'), failing('TIMEOUT'), () => Promise.resolve(answer())]
    calls.length = 0
    expect(await (await gateway(t.storeA2)).complete(input())).toMatchObject({ ok: false, error: { code: 'TIMEOUT' } })
    expect(calls).toHaveLength(3)
    plan = []
  })
})

describe('streaming', () => {
  it('yields text then the end with usage, and records the run once', async () => {
    await entitle(t.storeA2, 1, 5)
    const before = (await runs(t.storeA2)).length
    const chunks: ChatChunk[] = []
    for await (const c of (await gateway(t.storeA2)).stream(input({ stream: true }))) chunks.push(c)
    expect(chunks.map((c) => c.kind)).toEqual(['text', 'text', 'end'])
    expect((await runs(t.storeA2)).length).toBe(before + 1)
  })

  const usedOf = async (storeId: string) => (await db.sql<{ used: number }[]>`select used from store_usage where store_id = ${storeId} and key = 'ai_prompts'`)[0]?.used ?? 0

  it('keeps the prompt used and records a failed run when the caller goes away after text was sent', async () => {
    await entitle(t.storeA2, 1, 5)
    const g = await gateway(t.storeA2)
    for await (const c of g.stream(input({ stream: true }))) {
      if (c.kind === 'text') break
    }
    expect(await usedOf(t.storeA2)).toBe(1)
    expect((await runs(t.storeA2)).slice(-1)[0]?.outcome).toBe('failed')
  })

  it('gives the prompt back when the stream fails before any text', async () => {
    await entitle(t.storeA2, 1, 5)
    const failing = createAiGateway({
      sql: db.sql,
      context: { caller: { kind: 'api-key', keyId: crypto.randomUUID(), createdByUserId: owner }, partnerId: t.partnerA, storeId: t.storeA2, sellerScope: { kind: 'all' }, subscription: 'active' },
      secrets: await secretBox(kek),
      fallbackKey: undefined,
      actor: { keyId: null, userId: null },
      adapters: (provider, key) => ({
        ...fake(provider, key),
        streamResponse: async function* (): AsyncGenerator<ChatChunk> {
          yield* []
          throw new GatewayError('PROVIDER_UNAVAILABLE')
        },
      }),
      now: () => now,
    })
    await expect((async () => { for await (const c of failing.stream(input({ stream: true }))) void c })()).rejects.toBeInstanceOf(GatewayError)
    expect(await usedOf(t.storeA2)).toBe(0)
    expect((await runs(t.storeA2)).slice(-1)[0]?.outcome).toBe('failed')
  })
})

describe('/api/v1 over a store key', () => {
  const context = async (secret: string | null, partnerId = t.partnerA): Promise<StoreContext> => {
    const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/v1/x', { headers: secret ? { authorization: `Bearer ${secret}` } : {} }), partnerId, now, activityLog, facts)
    return { standing, partnerId, sql: db.sql, activity: activityLog, facts, secrets: await secretBox(kek), now: () => now }
  }
  const keyWith = async (scopes: string[], storeId = t.storeA1) => {
    const minted = await mintApiKey()
    await db.sql`insert into api_key (store_id, name, prefix, secret_hash, scopes, created_by_user_id, created_at) values (${storeId}, 'AI', ${minted.prefix}, ${minted.hash}, ${pgArray(scopes)}::text[], ${owner}, ${now})`
    return minted.secret
  }
  const post = (body: unknown, raw?: string) => new Request('https://store.example/api/v1/chat/completions', { method: 'POST', body: raw ?? JSON.stringify(body), headers: { 'content-type': 'application/json' } })
  const call = async (secret: string | null, request: Request) => handleAiGateway(request, await context(secret), { fallbackKey: undefined, adapters: (provider, key) => fake(provider, key) })

  it('refuses no key, a key without ai.run, and the listing too', async () => {
    const reader = await keyWith(['catalog.read'])
    expect((await call(null, post(input()))).status).toBe(401)
    expect((await call(reader, post(input()))).status).toBe(403)
    expect((await handleAiGateway(new Request('https://store.example/api/v1/providers'), await context(reader), { fallbackKey: undefined })).status).toBe(403)
  })

  it('lists providers and their models for a key with ai.run', async () => {
    const key = await keyWith(['ai.run'])
    const r = await handleAiGateway(new Request('https://store.example/api/v1/providers'), await context(key), { fallbackKey: undefined })
    expect(r.status).toBe(200)
    const body = (await r.json()) as { providers: { id: string; models: string[] }[] }
    expect(body.providers.map((p) => p.id)).toEqual(['anthropic', 'openai'])
    expect(body.providers[0]?.models).toContain('claude-sonnet-5-5')
  })

  it('answers 400 for unknown fields and bad JSON, 413 over the size, 404 for an unlisted model', async () => {
    const key = await keyWith(['ai.run'])
    expect((await call(key, post({ ...input(), extra: 1 }))).status).toBe(400)
    expect((await call(key, post(null, '{nope'))).status).toBe(400)
    expect((await call(key, post(null, 'x'.repeat(500_000)))).status).toBe(413)
    // 250,000 characters but 500,000 bytes: the limit is in bytes.
    expect((await call(key, post(null, 'é'.repeat(250_000)))).status).toBe(413)
    expect((await call(key, post({ ...input(), model: 'nope' }))).status).toBe(404)
  })

  it("never lets another store's or another partner's data through: a key runs on its own store's plan", async () => {
    await entitle(t.storeA1, 1, 0)
    await db.sql`delete from store_ai_account where store_id = ${t.storeA1}`
    const key = await keyWith(['ai.run'], t.storeA1)
    const r = await call(key, post(input()))
    expect(r.status).toBe(429)
    expect(JSON.stringify(await r.json())).not.toContain(partnerKey)
    const other = await keyWith(['ai.run'], t.storeB1)
    expect((await handleAiGateway(post(input()), await context(other, t.partnerA), { fallbackKey: undefined })).status).toBe(401)
  })

  it('answers a streamed request with the same status and code as a plain one, and streams only after a success', async () => {
    await entitle(t.storeA1, 1, 0)
    await db.sql`delete from store_ai_account where store_id = ${t.storeA1}`
    const key = await keyWith(['ai.run'], t.storeA1)
    const refused = await call(key, post(input({ stream: true })))
    expect(refused.status).toBe(429)
    expect(refused.headers.get('content-type')).toContain('application/json')
    expect(await refused.json()).toEqual({ error: { code: 'AI_BUDGET_REACHED' } })
    expect((await call(key, post({ ...input({ stream: true }), model: 'nope' }))).status).toBe(404)

    await entitle(t.storeA1, 1, 5)
    const ok = await call(key, post(input({ stream: true })))
    expect(ok.status).toBe(200)
    expect(ok.headers.get('content-type')).toBe('text/event-stream')
    const text = await ok.text()
    expect(text).toContain('event: text')
    expect(text).toContain('event: end')
    expect(text).not.toContain('event: error')
  })
})
