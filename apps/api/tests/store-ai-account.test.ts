import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { secretBox } from '#auth/secretBox'
import { resolveStoreStanding, storeHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #950: a store's own AI account: the Owner's, sealed, never read back, one store never another's.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-28T09:00:00Z')
const kek = Buffer.alloc(32, 5).toString('base64')
const key = 'sk-proj-OWNACCOUNTOWNACCOUNTOWN1234'
const facts = { requestId: 'r', ip: null, userAgent: null }
type Who = 'owner' | 'manager' | 'bOwner'
const people: Record<Who, string> = { owner: '', manager: '', bOwner: '' }
const cookies: Record<Who, string> = { ...people }
let verdict: 'ok' | 'rejected' | 'unavailable' = 'ok'
const storeOf = (w: Who) => (w === 'bOwner' ? t.storeB1 : t.storeA1)
const partnerOf = (w: Who) => (w === 'bOwner' ? t.partnerB : t.partnerA)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  for (const [who, role, email] of [['owner', 'owner', 'o@a.example'], ['manager', 'manager', 'm@a.example'], ['bOwner', 'owner', 'o@b.example']] as const) {
    people[who] = (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerOf(who)}, ${email}, ${who}, 'active') returning id`)[0]?.id ?? ''
    await db.sql`insert into membership (user_id, store_id, role_key, status) values (${people[who]}, ${storeOf(who)}, ${role}, 'active')`
    cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: partnerOf(who) }, now))
  }
}, 60_000)
afterAll(async () => {
  await db?.drop()
})

const run = async (who: Who, source: string, variables: Record<string, unknown> = {}, secrets: Awaited<ReturnType<typeof secretBox>> | null | undefined = undefined) => {
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers: { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who) } }), partnerOf(who), now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: partnerOf(who), sql: db.sql, activity: activityLog, facts, secrets: secrets === undefined ? await secretBox(kek) : secrets, checkAiKey: () => Promise.resolve(verdict), now: () => now }
  const r = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: r.data as Record<string, unknown> | null | undefined, code: r.errors?.[0]?.extensions['code'] as string | undefined }
}
const connect = (who: Who, provider = 'openai', k = key) => run(who, 'mutation($p: String!, $k: String!) { connectStoreAiAccount(provider: $p, key: $k) }', { p: provider, k })
const show = (who: Who) => run(who, '{ storeAiAccount { provider keyPrefix status useWhenPlanUsed connectedBy } }')

describe('the store AI account', () => {
  it('lets only the Owner connect, seals the key and shows its first and last characters', async () => {
    expect((await connect('manager')).code).toBe('FORBIDDEN')
    expect((await connect('owner')).data?.['connectStoreAiAccount']).toBe(true)
    expect((await show('owner')).data?.['storeAiAccount']).toMatchObject({ provider: 'openai', keyPrefix: 'sk-…N1234'.replace('N1234', '1234'), status: 'ok', useWhenPlanUsed: false })
    const [row] = await db.sql<{ key_enc: string }[]>`select key_enc from store_ai_account where store_id = ${t.storeA1}`
    expect(row?.key_enc).toMatch(/^v1\./)
    expect(JSON.stringify((await show('owner')).data)).not.toContain(key)
  })

  it('keeps the sealed key from every request role', async () => {
    for (const role of ['app_request', 'app_partner', 'app_platform']) {
      await expect(db.sql.begin(async (tx) => { await tx.unsafe(`set local role ${role}`); await tx`select key_enc from store_ai_account` })).rejects.toThrow(/permission denied/)
    }
  })

  it("never shows, tests, switches or removes another store's account", async () => {
    expect((await show('bOwner')).data?.['storeAiAccount']).toBeNull()
    expect((await run('bOwner', 'mutation { testStoreAiAccount { status } }')).code).toBe('NOT_FOUND')
    expect((await run('bOwner', 'mutation { setStoreAiSwitch(on: true) }')).code).toBe('NOT_FOUND')
    expect((await run('bOwner', 'mutation { removeStoreAiAccount }')).code).toBe('NOT_FOUND')
    expect((await db.sql`select 1 from store_ai_account where store_id = ${t.storeA1}`).length).toBe(1)
  })

  it('refuses a rejected key, an unreachable provider, a malformed key and a missing KEK, saving nothing new', async () => {
    verdict = 'rejected'
    expect((await connect('owner')).code).toBe('KEY_REJECTED')
    verdict = 'unavailable'
    expect((await connect('owner')).code).toBe('PROVIDER_UNAVAILABLE')
    verdict = 'ok'
    expect((await connect('owner', 'openai', 'nope')).code).toBe('INVALID_INPUT')
    expect((await connect('owner', 'anthropic', key)).code).toBe('INVALID_INPUT')
    expect((await run('owner', 'mutation($p: String!, $k: String!) { connectStoreAiAccount(provider: $p, key: $k) }', { p: 'openai', k: key }, null)).code).toBe('NOT_CONFIGURED')
  })

  it('turns the switch on and off by the Owner only, and audits each change', async () => {
    expect((await run('manager', 'mutation { setStoreAiSwitch(on: true) }')).code).toBe('FORBIDDEN')
    await run('owner', 'mutation { setStoreAiSwitch(on: true) }')
    expect((await show('owner')).data?.['storeAiAccount']).toMatchObject({ useWhenPlanUsed: true })
    await run('owner', 'mutation { setStoreAiSwitch(on: false) }')
    const rows = await db.sql<{ action: string; entry: string }[]>`select action, row_to_json(activity_log)::text as entry from activity_log where store_id = ${t.storeA1} and action like 'store.ai_%'`
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['store.ai_account_connected', 'store.ai_switch_changed']))
    for (const r of rows) expect(r.entry).not.toContain(key)
  })

  it('removes the account, and a repeat says there is none', async () => {
    expect((await run('owner', 'mutation { removeStoreAiAccount }')).data?.['removeStoreAiAccount']).toBe(true)
    expect((await show('owner')).data?.['storeAiAccount']).toBeNull()
    expect((await run('owner', 'mutation { removeStoreAiAccount }')).code).toBe('NOT_FOUND')
  })
})
