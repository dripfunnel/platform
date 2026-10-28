import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secretBox } from '#auth/secretBox'
import { withSystemScope } from '#db/scoped/index'
import { selectDefaultAiKey } from '#db/scoped/partnerCredentials'
import type { KeyCheck } from '#integrations/ai/provider'
import { activityLog } from '#saas/activity/index'
import { createPartnerCredentialsService, maxAiProfiles, partnerAiProvider } from '#saas/partnerCredentials/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #275: a partner's AI key profiles, sealed, never read back, one partner never another's.

let db: TestDatabase
const now = new Date('2026-10-27T09:00:00Z')
const ids = { ns: '', kl: '', fresh: '', kl2: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const kek = Buffer.alloc(32, 7).toString('base64')
const anthropicKey = 'sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAx7Qd'
const openaiKey = 'sk-proj-BBBBBBBBBBBBBBBBBBBBBBBBm2Zp'

let verdict: KeyCheck | null = 'ok'
const checked: string[] = []

const callerOf = (partnerId: string, role: PartnerRole, staff = false, impersonating = false): PartnerCaller => ({
  role,
  user: staff ? null : { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: staff || impersonating ? { id: crypto.randomUUID(), name: 'Priya Shah', email: 'priya@dripfunnel.example', session: { kind: impersonating ? 'impersonation' : 'setup', id: crypto.randomUUID(), expiresAt: new Date('2026-10-27T11:00:00Z') } } : null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const credentials = createPartnerCredentialsService({
    sql: db.sql,
    caller,
    facts,
    activity: activityLog,
    secrets: await secretBox(kek),
    checkKey: async (provider, key) => {
      checked.push(`${provider}:${key}`)
      return verdict
    },
    now: () => now,
  })
  const contextValue = { caller, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains: null, credentials }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const list = `{ partnerAiKeys { id provider name keyPrefix status isDefault lastTestedAt } }`
type Keys = { partnerAiKeys: { id: string; provider: string; name: string; keyPrefix: string; status: string; isDefault: boolean }[] }
const add = `mutation($provider: String!, $name: String!, $key: String!) { addPartnerAiKey(provider: $provider, name: $name, key: $key) { ok reason id } }`
type Added = { addPartnerAiKey: { ok: boolean; reason: string | null; id: string | null } }
const test = `mutation($id: ID!) { testPartnerAiKey(id: $id) { ok reason status } }`
const makeDefault = `mutation($id: ID!) { setDefaultPartnerAiKey(id: $id) { ok reason } }`
const remove = `mutation($id: ID!) { removePartnerAiKey(id: $id) { ok reason } }`

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  for (const [key, name] of [['ns', 'Northstar Commerce'], ['kl', 'Kaufladen Digital']] as const) {
    ids[key] = (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  }
  for (const key of ['fresh', 'kl2'] as const) {
    ids[key] = (await db.sql<{ id: string }[]>`insert into partner (name, state) values (${`Credentials ${key}`}, 'live') returning id`)[0]?.id ?? ''
  }
}, 120_000)

afterAll(async () => {
  await db.drop()
})

describe('AI key profiles', () => {
  it('seals the first key, makes it the default and shows only its first and last characters', async () => {
    const added = await run<Added>(add, callerOf(ids.ns, 'partner-owner'), { provider: 'anthropic', name: 'Production', key: anthropicKey })
    expect(added.data?.addPartnerAiKey.ok).toBe(true)
    const shown = await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))
    expect(shown.data?.partnerAiKeys).toMatchObject([{ provider: 'anthropic', name: 'Production', keyPrefix: 'sk-ant-…x7Qd', status: 'ok', isDefault: true }])
    expect(JSON.stringify(shown.data)).not.toContain(anthropicKey)
    const stored = await db.sql<{ key_enc: string }[]>`select key_enc from partner_credential where partner_id = ${ids.ns}`
    expect(stored[0]?.key_enc).toMatch(/^v1\./)
    expect(stored[0]?.key_enc).not.toContain(anthropicKey)
  })

  it('saves an OpenAI key as not tested and keeps the first key the default', async () => {
    verdict = null
    const added = await run<Added>(add, callerOf(ids.ns, 'partner-admin'), { provider: 'openai', name: 'Cheaper translations', key: openaiKey })
    expect(added.data?.addPartnerAiKey.ok).toBe(true)
    const shown = await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))
    expect(shown.data?.partnerAiKeys.map((k) => [k.name, k.status, k.isDefault])).toEqual([['Production', 'ok', true], ['Cheaper translations', 'untested', false]])
    verdict = 'ok'
  })

  it('refuses a rejected key, an unreachable provider, a malformed key and a repeated name, saving nothing', async () => {
    const before = (await db.sql`select 1 from partner_credential where partner_id = ${ids.ns}`).length
    verdict = 'rejected'
    expect((await run<Added>(add, callerOf(ids.ns, 'partner-owner'), { provider: 'anthropic', name: 'Bad', key: anthropicKey })).data?.addPartnerAiKey.reason).toBe('KEY_REJECTED')
    verdict = 'unavailable'
    expect((await run<Added>(add, callerOf(ids.ns, 'partner-owner'), { provider: 'anthropic', name: 'Down', key: anthropicKey })).data?.addPartnerAiKey.reason).toBe('PROVIDER_UNAVAILABLE')
    verdict = 'ok'
    expect((await run<Added>(add, callerOf(ids.ns, 'partner-owner'), { provider: 'anthropic', name: 'Wrong shape', key: 'sk-proj-AAAAAAAAAAAAAAAAAAAAAAAA' })).data?.addPartnerAiKey.reason).toBe('INVALID_INPUT')
    expect((await run<Added>(add, callerOf(ids.ns, 'partner-owner'), { provider: 'anthropic', name: 'production', key: anthropicKey })).data?.addPartnerAiKey.reason).toBe('NAME_TAKEN')
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.ns}`).length).toBe(before)
  })

  it('tests a stored key with the provider and records the answer', async () => {
    const id = (await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))).data?.partnerAiKeys[0]?.id ?? ''
    checked.length = 0
    verdict = 'rejected'
    const result = await run<{ testPartnerAiKey: { ok: boolean; status: string } }>(test, callerOf(ids.ns, 'partner-owner'), { id })
    expect(result.data?.testPartnerAiKey).toMatchObject({ ok: true, status: 'rejected' })
    expect(checked).toEqual([`anthropic:${anthropicKey}`])
    expect((await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))).data?.partnerAiKeys[0]?.status).toBe('rejected')
    verdict = 'ok'
  })

  it('moves the default, and promotes another profile when the default is removed', async () => {
    const [first, second] = (await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))).data?.partnerAiKeys ?? []
    await run(makeDefault, callerOf(ids.ns, 'partner-owner'), { id: second?.id })
    expect((await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))).data?.partnerAiKeys.map((k) => k.isDefault)).toEqual([false, true])
    await run(remove, callerOf(ids.ns, 'partner-owner'), { id: second?.id })
    const left = (await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))).data?.partnerAiKeys
    expect(left).toHaveLength(1)
    expect(left?.[0]).toMatchObject({ id: first?.id, isDefault: true })
  })

  it('hands the default key to system scope only, opened back to what was typed', async () => {
    const row = await withSystemScope(db.sql, (tx) => selectDefaultAiKey(tx, ids.ns))
    expect(row?.provider).toBe('anthropic')
    expect(await (await secretBox(kek)).open(row?.key_enc ?? '')).toBe(anthropicKey)
  })

  it('audits each write without the key', async () => {
    const rows = await db.sql<{ action: string; entry: string }[]>`select action, row_to_json(activity_log)::text as entry from activity_log where partner_id = ${ids.ns} and action like 'partner.ai_key_%'`
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['partner.ai_key_added', 'partner.ai_key_tested', 'partner.ai_key_default_set', 'partner.ai_key_removed']))
    for (const r of rows) {
      expect(r.entry).not.toContain(anthropicKey)
      expect(r.entry).not.toContain(openaiKey)
    }
  })
})

describe('who may', () => {
  it('lets Owner, Admin and a staff setup session write, and refuses Support, Finance and Read-only', async () => {
    const name = (n: string) => ({ provider: 'anthropic', name: n, key: anthropicKey })
    for (const [role, staff, ok] of [['partner-admin', false, true], ['partner-owner', true, true], ['partner-support', false, false], ['partner-finance', false, false], ['partner-read-only', false, false]] as const) {
      const r = await run<Added>(add, callerOf(ids.ns, role, staff), name(`by ${role}${staff ? ' setup' : ''}`))
      if (ok) expect(r.data?.addPartnerAiKey.ok).toBe(true)
      else expect(r.code).toBe('FORBIDDEN')
    }
  })

  it('refuses the list to every role but Owner and Admin, since it shows key names and prefixes', async () => {
    for (const role of ['partner-support', 'partner-finance', 'partner-read-only'] as const) {
      expect((await run<Keys>(list, callerOf(ids.ns, role))).code).toBe('FORBIDDEN')
    }
    expect((await run<Keys>(list, callerOf(ids.ns, 'partner-admin'))).data?.partnerAiKeys.length).toBeGreaterThan(0)
  })

  it('refuses add, default and remove to an impersonation, and lets it test a key', async () => {
    const imp = callerOf(ids.ns, 'partner-owner', false, true)
    const id = (await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))).data?.partnerAiKeys[0]?.id ?? ''
    expect((await run<Added>(add, imp, { provider: 'anthropic', name: 'By impersonation', key: anthropicKey })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await run(makeDefault, imp, { id })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await run(remove, imp, { id })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await run<{ testPartnerAiKey: { ok: boolean } }>(test, imp, { id })).data?.testPartnerAiKey.ok).toBe(true)
  })
})

describe('isolation between partners', () => {
  it("never shows, tests, defaults or removes another partner's key", async () => {
    const mine = (await run<Keys>(list, callerOf(ids.ns, 'partner-owner'))).data?.partnerAiKeys[0]?.id ?? ''
    expect((await run<Keys>(list, callerOf(ids.kl, 'partner-owner'))).data?.partnerAiKeys).toEqual([])
    for (const source of [test, makeDefault, remove]) {
      const r = await run<Record<string, { ok: boolean; reason: string }>>(source, callerOf(ids.kl, 'partner-owner'), { id: mine })
      expect(Object.values(r.data ?? {})[0]).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
    }
    expect((await db.sql`select 1 from partner_credential where id = ${mine}`).length).toBe(1)
  })

  it("lets each partner use the same name for its own key", async () => {
    const r = await run<Added>(add, callerOf(ids.kl, 'partner-owner'), { provider: 'anthropic', name: 'Production', key: anthropicKey })
    expect(r.data?.addPartnerAiKey.ok).toBe(true)
  })

  it('keeps the sealed key from every console role', async () => {
    for (const role of ['app_partner', 'app_platform', 'app_request']) {
      await expect(db.sql.begin(async (tx) => {
        await tx.unsafe(`set local role ${role}`)
        await tx`select key_enc from partner_credential`
      })).rejects.toThrow(/permission denied/)
    }
  })
})

describe('without CREDENTIALS_KEK', () => {
  it('refuses to save a key rather than keep it in the clear', async () => {
    const caller = callerOf(ids.ns, 'partner-owner')
    const bare = createPartnerCredentialsService({ sql: db.sql, caller, facts, activity: activityLog, secrets: null, checkKey: async () => 'ok', now: () => now })
    expect(await bare.addAiKey({ provider: 'anthropic', name: 'No KEK', key: anthropicKey })).toEqual({ ok: false, reason: 'NOT_CONFIGURED' })
  })
})

describe('the default under concurrency and limits', () => {
  it('lets two simultaneous first adds both succeed with exactly one default', async () => {
    const caller = callerOf(ids.fresh, 'partner-owner')
    const results = await Promise.all(['One', 'Two'].map((name) => run<Added>(add, caller, { provider: 'anthropic', name, key: anthropicKey })))
    expect(results.map((r) => r.data?.addPartnerAiKey.ok)).toEqual([true, true])
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.fresh} and is_default`).length).toBe(1)
  })

  it('keeps one default when two different keys are made the default at once', async () => {
    const caller = callerOf(ids.fresh, 'partner-owner')
    const [a, b] = (await run<Keys>(list, caller)).data?.partnerAiKeys ?? []
    await Promise.all([run(makeDefault, caller, { id: a?.id }), run(makeDefault, caller, { id: b?.id })])
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.fresh} and is_default`).length).toBe(1)
  })

  it('stops at the cap on keys per partner', async () => {
    const caller = callerOf(ids.fresh, 'partner-owner')
    const held = (await db.sql`select 1 from partner_credential where partner_id = ${ids.fresh}`).length
    for (let n = held; n < maxAiProfiles; n++) await run<Added>(add, caller, { provider: 'anthropic', name: `Key ${n}`, key: anthropicKey })
    expect((await run<Added>(add, caller, { provider: 'anthropic', name: 'One too many', key: anthropicKey })).data?.addPartnerAiKey.reason).toBe('LIMIT_REACHED')
  })
})

describe('the designer\'s model', () => {
  const box = () => secretBox(kek)
  it('uses the platform key only for a partner with no key at all', async () => {
    expect(await partnerAiProvider(db.sql, await box(), ids.kl2, undefined)).toBeNull()
    expect(await partnerAiProvider(db.sql, await box(), ids.kl2, 'sk-ant-api03-FALLBACKFALLBACKFALLBACK')).not.toBeNull()
  })

  it('pauses, rather than fall back, while the default is rejected, unreadable or OpenAI', async () => {
    const fallback = 'sk-ant-api03-FALLBACKFALLBACKFALLBACK'
    const caller = callerOf(ids.kl2, 'partner-owner')
    const id = (await run<Added>(add, caller, { provider: 'anthropic', name: 'Mine', key: anthropicKey })).data?.addPartnerAiKey.id
    expect(await partnerAiProvider(db.sql, await box(), ids.kl2, fallback)).not.toBeNull()
    verdict = 'rejected'
    await run(test, caller, { id })
    verdict = 'ok'
    expect(await partnerAiProvider(db.sql, await box(), ids.kl2, fallback)).toBeNull()
    const id2 = id ?? ''
    await db.sql`update partner_credential set status = 'ok', key_enc = 'v1.broken.broken' where id = ${id2}`
    expect(await partnerAiProvider(db.sql, await box(), ids.kl2, fallback)).toBeNull()
    expect(await partnerAiProvider(db.sql, null, ids.kl2, fallback)).toBeNull()
    const sealed = await (await box()).seal(openaiKey)
    await db.sql`update partner_credential set provider = 'openai', key_enc = ${sealed} where id = ${id2}`
    expect(await partnerAiProvider(db.sql, await box(), ids.kl2, fallback)).toBeNull()
  })
})
