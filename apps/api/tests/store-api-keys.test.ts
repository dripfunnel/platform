import { createHash } from 'node:crypto'
import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { machineScopes } from '#auth/apiKeys'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { selectApiKeys } from '#db/scoped/apiKeys'
import { withScope, withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #330 (SAPI 20), part 1: the store's API keys (ACCESS §5.6, §11): shown once, kept hashed, scoped, bound to a
// supplier or not, rotated with a day's grace, revoked at once, and calling the Store API within their scopes only.

let db: TestDatabase
let t: Tenants
let now = new Date('2026-10-10T09:00:30Z')
type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'a2Owner' | 'bOwner' | 'coOwner'
const people: Record<Who, string> = { owner: '', manager: '', staff: '', supplier: '', a2Owner: '', bOwner: '', coOwner: '' }
const cookies: Record<Who, string> = { ...people }
const memberships: Partial<Record<Who, string>> = {}

const partnerOf = (who: Who) => (who === 'bOwner' ? t.partnerB : t.partnerA)
const storeOf = (who: Who) => (who === 'bOwner' ? t.storeB1 : who === 'a2Owner' ? t.storeA2 : t.storeA1)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  const user = async (who: Who, partnerId: string, email: string, name: string) => {
    people[who] = (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${email}, ${name}, 'active') returning id`)[0]?.id ?? ''
  }
  await user('owner', t.partnerA, 'owner@a.example', 'Olivia')
  await user('coOwner', t.partnerA, 'co@a.example', 'Cora')
  await user('manager', t.partnerA, 'manager@a.example', 'Mo')
  await user('staff', t.partnerA, 'staff@a.example', 'Sam')
  await user('supplier', t.partnerA, 'anand@a.example', 'Anand')
  await user('a2Owner', t.partnerA, 'owner@a2.example', 'Asha')
  await user('bOwner', t.partnerB, 'owner@b.example', 'Bea')
  const member = async (who: Who, role: string, sellerId: string | null = null) => {
    memberships[who] = (await db.sql<{ id: string }[]>`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people[who]}, ${storeOf(who)}, ${sellerId}, ${role}, 'active') returning id`)[0]?.id ?? ''
  }
  await member('owner', 'owner')
  await member('coOwner', 'owner')
  await member('manager', 'manager')
  await member('staff', 'staff')
  await member('supplier', 'supplier-admin', t.sellerA1First)
  await member('a2Owner', 'owner')
  await member('bOwner', 'owner')
  // A plan with room for products, as the catalogue's tests set one.
  for (const [partnerId, storeId] of [[t.partnerA, t.storeA1], [t.partnerA, t.storeA2], [t.partnerB, t.storeB1]] as const) {
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Full ${storeId}`}, 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 100), (${plan?.id ?? ''}, ${partnerId}, 1, 'staff', 10)`
    await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
    await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
      values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${now}, ${new Date(now.getTime() + 30 * 86_400_000)})`
  }
  for (const who of Object.keys(cookies) as Who[]) cookies[who] = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: people[who], partnerId: partnerOf(who) }, now))
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const facts = { requestId: 'r', ip: null, userAgent: null }

const run = async (headers: Record<string, string>, partnerId: string, source: string, variables: Record<string, unknown> = {}) => {
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), partnerId, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, standing: standing.kind }
}

const gql = (who: Who, source: string, variables: Record<string, unknown> = {}) =>
  run({ cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who), ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }, partnerOf(who), source, variables)

const withKey = (secret: string, source: string, variables: Record<string, unknown> = {}, extra: Record<string, string> = {}, partnerId = t.partnerA) =>
  run({ authorization: `Bearer ${secret}`, ...extra }, partnerId, source, variables)

interface Issued {
  id: string
  prefix: string
  secret: string
}
const create = async (who: Who, input: { name?: string; scopes?: string[]; supplierId?: string | null; expiresInDays?: number | null } = {}) => {
  const r = await gql(
    who,
    'mutation C($name: String!, $scopes: [String!]!, $supplierId: ID, $days: Int) { createApiKey(name: $name, scopes: $scopes, supplierId: $supplierId, expiresInDays: $days) { id prefix secret } }',
    { name: input.name ?? 'Stock sync', scopes: input.scopes ?? ['catalog.read'], supplierId: input.supplierId ?? null, days: input.expiresInDays === undefined ? 90 : input.expiresInDays },
  )
  return { key: r.data?.['createApiKey'] as Issued | undefined, code: r.code }
}
const rotate = async (who: Who, id: string) => {
  const r = await gql(who, 'mutation R($id: ID!) { rotateApiKey(id: $id) { id prefix secret } }', { id })
  return { key: r.data?.['rotateApiKey'] as Issued | undefined, code: r.code }
}
const revoke = async (who: Who, id: string) => (await gql(who, 'mutation V($id: ID!) { revokeApiKey(id: $id) }', { id })).code
interface Listed {
  id: string
  name: string
  prefix: string
  scopes: string[]
  supplier: { id: string; name: string } | null
  createdByName: string | null
  createdByHere: boolean
  expiresAt: string | null
  lastUsedAt: string | null
  previousWorksUntil: string | null
}
const list = async (who: Who) => {
  const r = await gql(who, '{ apiKeys { nodes { id name prefix scopes supplier { id name } createdByName createdByHere expiresAt lastUsedAt previousWorksUntil } pageInfo { hasNextPage } } }')
  return { keys: (r.data?.['apiKeys'] as { nodes: Listed[] } | null)?.nodes, code: r.code }
}
const product = async (who: Who, name: string) => {
  const r = await gql(who, 'mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', { input: { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] } })
  return (r.data?.['saveProduct'] as { id: string } | undefined)?.id ?? ''
}
const productNames = async (secret: string, extra: Record<string, string> = {}) => {
  const r = await withKey(secret, '{ products { nodes { name } } }', {}, extra)
  return { names: (r.data?.['products'] as { nodes: { name: string }[] } | null)?.nodes.map((n) => n.name).sort(), code: r.code }
}

describe('Creating, listing and reading keys', () => {
  it('shows the secret once, keeps only its hash, and never logs it', async () => {
    const { key, code } = await create('owner', { name: 'Warehouse sync', scopes: ['catalog.read', 'stock.read'] })
    expect(code).toBeUndefined()
    expect(key?.secret).toMatch(/^dfk_[0-9A-Za-z]{48}$/)
    expect(key?.prefix).toBe(key?.secret.slice(0, 12))
    const [row] = await db.sql<{ secret_hash: string; scopes: string[] }[]>`select secret_hash, scopes from api_key where id = ${key?.id ?? ''}`
    expect(row?.secret_hash).toBe(createHash('sha256').update(key?.secret ?? '').digest('hex'))
    const listed = (await list('owner')).keys?.find((k) => k.id === key?.id)
    expect(listed).toMatchObject({ name: 'Warehouse sync', scopes: ['catalog.read', 'stock.read'], supplier: null, createdByName: 'Olivia', createdByHere: true, lastUsedAt: null, previousWorksUntil: null })
    expect(JSON.stringify(listed)).not.toContain(key?.secret.slice(12))
    const entries = await db.sql<{ action: string; actor_id: string; text: string }[]>`select action, actor_id, row_to_json(a)::text as text from activity_log a where target_id = ${key?.id ?? ''}`
    expect(entries.map((e) => [e.action, e.actor_id])).toEqual([['api_key.created', people.owner]])
    expect(entries[0]?.text).not.toContain(key?.secret.slice(4))
    // The request role can't read the hash back, whatever it asks.
    await expect(withScope(db.sql, { caller: { kind: 'person', userId: people.owner, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }, (tx) => tx`select secret_hash from api_key`)).rejects.toThrow(/permission denied/)
  })

  it('offers only the scopes keys can use, and refuses a name, lifetime or scope outside them', async () => {
    const choices = await gql('owner', '{ apiKeyChoices { scopes expiresInDays maxKeys } }')
    expect(choices.data?.['apiKeyChoices']).toEqual({ scopes: [...machineScopes], expiresInDays: [30, 90, 365], maxKeys: 50 })
    expect((await create('owner', { name: ' ' })).code).toBe('INVALID_INPUT')
    expect((await create('owner', { expiresInDays: 7 })).code).toBe('INVALID_INPUT')
    expect((await create('owner', { scopes: [] })).code).toBe('INVALID_SCOPES')
    expect((await create('owner', { scopes: ['catalog.write'] })).code).toBe('INVALID_SCOPES')
    expect((await create('owner', { scopes: ['settings'] })).code).toBe('INVALID_SCOPES')
    expect((await create('owner', { expiresInDays: null })).code).toBeUndefined()
  })

  it('is the Owner’s alone: Managers, Staff and suppliers are refused every field', async () => {
    const { key } = await create('owner')
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      expect((await list(who)).code, who).toBe('FORBIDDEN')
      expect((await create(who)).code, who).toBe('FORBIDDEN')
      expect((await rotate(who, key?.id ?? '')).code, who).toBe('FORBIDDEN')
      expect(await revoke(who, key?.id ?? ''), who).toBe('FORBIDDEN')
      expect((await gql(who, '{ apiKeyChoices { maxKeys } }')).code, who).toBe('FORBIDDEN')
    }
  })

  it('keeps a store’s keys to it: another store’s Owner lists none of them and can’t rotate or revoke one', async () => {
    const { key } = await create('owner', { name: 'A1 only' })
    for (const who of ['a2Owner', 'bOwner'] as const) {
      expect((await list(who)).keys?.map((k) => k.id), who).not.toContain(key?.id)
      expect((await rotate(who, key?.id ?? '')).code, who).toBe('NOT_FOUND')
      expect(await revoke(who, key?.id ?? ''), who).toBe('NOT_FOUND')
    }
    expect(await db.sql`select 1 from api_key where id = ${key?.id ?? ''} and revoked_at is null and superseded_at is null`).toHaveLength(1)
  })

  it('refuses a support session’s writes in the database too', async () => {
    const support = { caller: { kind: 'support' as const, supportSessionId: 'ss', partnerUserId: 'pu', access: 'write' as const }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' as const }, subscription: 'active' as const }
    await expect(withScope(db.sql, support, (tx) => tx`insert into api_key (store_id, name, prefix, secret_hash, scopes, created_by_user_id) values (${t.storeA1}, 'x', 'dfk_abcdefgh', ${'0'.repeat(64)}, '{catalog.read}', ${people.owner})`)).rejects.toThrow(/row-level security/)
  })
})

describe('A key calling the Store API', () => {
  it('reads its own store’s products, stock, orders and customers, and records when it was used', async () => {
    await product('owner', 'Own lamp')
    await product('a2Owner', 'Sibling lamp')
    const { key } = await create('owner', { name: 'Reader', scopes: [...machineScopes] })
    const secret = key?.secret ?? ''
    expect(await productNames(secret)).toMatchObject({ names: expect.arrayContaining(['Own lamp']) })
    expect((await productNames(secret)).names).not.toContain('Sibling lamp')
    const counts = await withKey(secret, '{ productCounts { all } customerCount orderCounts { all } warehouses { nodes { name } } customers { nodes { id } } orders { nodes { id } } }')
    expect(counts.code).toBeUndefined()
    expect(counts.data?.['customerCount']).toBe(1)
    expect((counts.data?.['customers'] as { nodes: { id: string }[] }).nodes.map((c) => c.id)).toEqual([t.customerA1])
    expect((await list('owner')).keys?.find((k) => k.id === key?.id)?.lastUsedAt).toBe(now.toISOString())
  })

  it('names its own store whatever the request says, and works on no other partner’s host', async () => {
    const { key } = await create('owner', { name: 'Header' })
    const secret = key?.secret ?? ''
    expect((await productNames(secret, { [storeHeader]: t.storeA2 })).names).not.toContain('Sibling lamp')
    expect((await withKey(secret, '{ products { nodes { name } } }', {}, {}, t.partnerB)).code).toBe('UNAUTHENTICATED')
    // A key beside the portal's cookie is refused like a bad one.
    expect((await withKey(secret, '{ products { nodes { name } } }', {}, { cookie: `${storeCookieName}=${cookies.owner}` })).code).toBe('UNAUTHENTICATED')
    expect((await withKey(`${secret.slice(0, -1)}x`, '{ products { nodes { name } } }')).code).toBe('UNAUTHENTICATED')
  })

  it('reaches only the fields open to keys, within its scopes', async () => {
    const { key } = await create('owner', { name: 'Narrow', scopes: ['catalog.read'] })
    const secret = key?.secret ?? ''
    expect((await withKey(secret, '{ orders { nodes { id } } }')).code).toBe('FORBIDDEN')
    expect((await withKey(secret, '{ customers { nodes { id } } }')).code).toBe('FORBIDDEN')
    // A field no key may call, a session's own field, an Owner's and a write.
    expect((await withKey(secret, '{ people { nodes { id } } }')).code).toBe('FORBIDDEN')
    expect((await withKey(secret, '{ myStores { pageInfo { hasNextPage } } }')).code).toBe('FORBIDDEN')
    expect((await withKey(secret, '{ apiKeys { nodes { id } } }')).code).toBe('FORBIDDEN')
    expect((await withKey(secret, 'mutation { revokeApiKey(id: "00000000-0000-4000-8000-000000000000") }')).code).toBe('FORBIDDEN')
    expect((await withKey(secret, 'mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', { input: { name: 'x', options: [], versions: [] } })).code).toBe('FORBIDDEN')
    expect((await withKey(secret, '{ me { id } }')).data?.['me']).toBeNull()
  })

  it('is held to its supplier when bound to one, within that supplier’s tier, and stops with it', async () => {
    await product('supplier', 'Anand scarf')
    expect((await create('owner', { supplierId: t.sellerA1Second, scopes: ['catalog.read'] })).code).toBeUndefined()
    // vendor-catalogue reads no orders, and no supplier reads customers.
    expect((await create('owner', { supplierId: t.sellerA1First, scopes: ['orders.read'] })).code).toBe('INVALID_SCOPES')
    expect((await create('owner', { supplierId: t.sellerA1First, scopes: ['customers.read'] })).code).toBe('INVALID_SCOPES')
    expect((await create('owner', { supplierId: t.sellerB1 })).code).toBe('NOT_FOUND')
    const { key } = await create('owner', { name: 'Anand feed', supplierId: t.sellerA1First, scopes: ['catalog.read', 'stock.read'] })
    const secret = key?.secret ?? ''
    expect((await list('owner')).keys?.find((k) => k.id === key?.id)?.supplier).toEqual({ id: t.sellerA1First, name: 'Anand Textiles' })
    expect((await productNames(secret)).names).toEqual(['Anand scarf'])
    expect((await withKey(secret, '{ productCounts { all } }')).data?.['productCounts']).toEqual({ all: 1 })
    expect((await withKey(secret, '{ customerCount }')).code).toBe('FORBIDDEN')
    // Its tier narrowed on the next request: vendor-stock still reads the catalogue and stock.
    await db.sql`update seller set access_level = 'vendor-stock' where id = ${t.sellerA1First}`
    expect((await productNames(secret)).names).toEqual(['Anand scarf'])
    await db.sql`update seller set status = 'suspended' where id = ${t.sellerA1First}`
    expect((await productNames(secret)).code).toBe('UNAUTHENTICATED')
    expect((await rotate('owner', key?.id ?? '')).code).toBe('NOT_FOUND')
    expect(await revoke('owner', key?.id ?? '')).toBeUndefined()
    await db.sql`update seller set status = 'active', access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
    expect((await productNames(secret)).code).toBe('UNAUTHENTICATED')
  })

  it('keeps reading while the store is past due, and stops for a suspended store', async () => {
    const { key } = await create('owner', { name: 'Status' })
    const secret = key?.secret ?? ''
    try {
      await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
      expect((await productNames(secret)).code).toBeUndefined()
      await db.sql`update store set status = 'suspended', suspended_at = now(), suspended_reason = 'test', suspended_previous_status = 'active' where id = ${t.storeA1}`
      expect((await productNames(secret)).code).toBe('STORE_SUSPENDED')
    } finally {
      await db.sql`update store set status = 'active', suspended_at = null, suspended_reason = null, suspended_previous_status = null where id = ${t.storeA1}`
    }
  })
})

describe('Rotating, revoking and expiring', () => {
  it('gives a new secret and keeps the old one working a day, then not', async () => {
    const { key: first } = await create('owner', { name: 'Rotating' })
    const { key: second, code } = await rotate('owner', first?.id ?? '')
    expect(code).toBeUndefined()
    expect(second?.secret).not.toBe(first?.secret)
    const listed = (await list('owner')).keys ?? []
    expect(listed.map((k) => k.id)).toContain(second?.id)
    expect(listed.map((k) => k.id)).not.toContain(first?.id)
    expect(listed.find((k) => k.id === second?.id)?.previousWorksUntil).toBe(new Date(now.getTime() + 86_400_000).toISOString())
    expect((await productNames(first?.secret ?? '')).code).toBeUndefined()
    expect((await productNames(second?.secret ?? '')).code).toBeUndefined()
    // Only the newest is the one to rotate or revoke.
    expect((await rotate('owner', first?.id ?? '')).code).toBe('NOT_FOUND')
    const saved = now
    now = new Date(saved.getTime() + 86_400_000 + 1000)
    try {
      expect((await productNames(first?.secret ?? '')).code).toBe('UNAUTHENTICATED')
      expect((await productNames(second?.secret ?? '')).code).toBeUndefined()
    } finally {
      now = saved
    }
    const entries = await db.sql<{ action: string }[]>`select action from activity_log where target_id = ${second?.id ?? ''}`
    expect(entries.map((e) => e.action)).toEqual(['api_key.rotated'])
  })

  it('revokes a key and the secret it was rotated from at once', async () => {
    const { key: first } = await create('owner', { name: 'Revoked' })
    const { key: second } = await rotate('owner', first?.id ?? '')
    expect(await revoke('owner', second?.id ?? '')).toBeUndefined()
    expect((await productNames(first?.secret ?? '')).code).toBe('UNAUTHENTICATED')
    expect((await productNames(second?.secret ?? '')).code).toBe('UNAUTHENTICATED')
    expect(await revoke('owner', second?.id ?? '')).toBe('NOT_FOUND')
    expect((await list('owner')).keys?.map((k) => k.id)).not.toContain(second?.id)
  })

  it('stops a key at its expiry', async () => {
    const { key } = await create('owner', { name: 'Short', expiresInDays: 30 })
    const saved = now
    now = new Date(saved.getTime() + 30 * 86_400_000 + 1000)
    try {
      expect((await productNames(key?.secret ?? '')).code).toBe('UNAUTHENTICATED')
      const listed = await withScope(db.sql, { caller: { kind: 'person', userId: people.owner, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }, (tx) => selectApiKeys(tx, t.storeA1, { limit: 50, after: null, before: null }, now))
      expect(listed.map((k) => k.id)).not.toContain(key?.id)
    } finally {
      now = saved
    }
  })

  it('mints one successor however many rotations race, and a revocation racing a rotation leaves nothing working', async () => {
    const { key } = await create('owner', { name: 'Raced' })
    const results = await Promise.all([rotate('owner', key?.id ?? ''), rotate('owner', key?.id ?? ''), rotate('owner', key?.id ?? '')])
    expect(results.filter((r) => r.key).length).toBe(1)
    expect(results.filter((r) => r.code === 'NOT_FOUND').length).toBe(2)
    expect(await db.sql`select 1 from api_key where rotated_from_id = ${key?.id ?? ''}`).toHaveLength(1)
    const { key: other } = await create('owner', { name: 'Raced 2' })
    const [rotated, revoked] = await Promise.all([rotate('owner', other?.id ?? ''), revoke('owner', other?.id ?? '')])
    const survivors = await db.sql`select 1 from api_key where (id = ${other?.id ?? ''} or rotated_from_id = ${other?.id ?? ''}) and revoked_at is null and superseded_at is null`
    // One of the two wins: a revocation first leaves nothing live; a rotation first leaves the revocation nothing to find.
    if (rotated.key) expect([revoked, survivors.length]).toEqual(['NOT_FOUND', 1])
    else expect([rotated.code, revoked, survivors.length]).toEqual(['NOT_FOUND', undefined, 0])
  })

  it('holds a store to its number of keys, even when creations race', async () => {
    expect(await db.sql`select 1 from api_key where store_id = ${t.storeA2}`).toHaveLength(0)
    for (let i = 0; i < 48; i++) expect((await create('a2Owner', { name: `k${i}` })).code).toBeUndefined()
    const raced = await Promise.all([create('a2Owner', { name: 'x' }), create('a2Owner', { name: 'y' }), create('a2Owner', { name: 'z' })])
    expect(raced.filter((r) => r.key).length).toBe(2)
    expect(raced.filter((r) => r.code === 'TOO_MANY_KEYS').length).toBe(1)
  })
})

describe('Plan limits and the creator leaving', () => {
  it('answers RATE_LIMITED past the month’s calls until the next month starts, and counts a new month from one', async () => {
    const { key } = await create('bOwner', { name: 'Monthly' })
    const secret = key?.secret ?? ''
    const saved = now
    try {
      // The last minute of December: the quota opens at midnight UTC on 1 January.
      now = new Date('2026-12-31T23:59:00Z')
      await db.sql`insert into api_usage (store_id, minute_start, minute_used, month_start, month_used) values (${t.storeB1}, ${now}, 0, '2026-12-01', 100000)
        on conflict (store_id) do update set minute_start = excluded.minute_start, minute_used = 0, month_start = excluded.month_start, month_used = 100000`
      const over = await withKey(secret, '{ productCounts { all } }', {}, {}, t.partnerB)
      expect([over.standing, over.code]).toEqual(['limited', 'RATE_LIMITED'])
      const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers: { authorization: `Bearer ${secret}` } }), t.partnerB, now, activityLog, facts)
      expect(standing).toEqual({ kind: 'limited', retryAfterSeconds: 60 })
      now = new Date('2027-01-01T00:00:30Z')
      expect((await withKey(secret, '{ productCounts { all } }', {}, {}, t.partnerB)).code).toBeUndefined()
      expect((await db.sql<{ month_start: string; month_used: number }[]>`select to_char(month_start, 'YYYY-MM-DD') as month_start, month_used from api_usage where store_id = ${t.storeB1}`)[0]).toEqual({ month_start: '2027-01-01', month_used: 1 })
    } finally {
      now = saved
      await db.sql`delete from api_usage where store_id = ${t.storeB1}`
    }
  })

  it('answers RATE_LIMITED past the plan’s calls this minute, and again once the minute turns', async () => {
    const { key } = await create('bOwner', { name: 'Busy' })
    const secret = key?.secret ?? ''
    for (let i = 0; i < 60; i++) expect((await withKey(secret, '{ productCounts { all } }', {}, {}, t.partnerB)).code).toBeUndefined()
    const over = await withKey(secret, '{ productCounts { all } }', {}, {}, t.partnerB)
    expect([over.standing, over.code]).toEqual(['limited', 'RATE_LIMITED'])
    const saved = now
    now = new Date(saved.getTime() + 60_000)
    try {
      expect((await withKey(secret, '{ productCounts { all } }', {}, {}, t.partnerB)).code).toBeUndefined()
    } finally {
      now = saved
    }
    expect(await db.sql`select 1 from api_usage where store_id = ${t.storeA1} and minute_used > 60`).toHaveLength(0)
  })

  it('keeps a key working when its creator stops being an Owner, says so in the list, and tells the Owners left', async () => {
    const { key } = await create('coOwner', { name: 'Cora’s key' })
    expect((await gql('owner', 'mutation M($id: ID!) { changeRole(membershipId: $id, role: "manager") }', { id: memberships.coOwner })).code).toBeUndefined()
    expect((await list('owner')).keys?.find((k) => k.id === key?.id)).toMatchObject({ createdByName: 'Cora', createdByHere: false })
    expect((await productNames(key?.secret ?? '')).code).toBeUndefined()
    const emails = await db.sql<{ creator: string; keys: number }[]>`select payload->>'creatorId' as creator, (payload->>'keys')::int as keys from outbox where payload->>'template' = 'api-keys-creator-gone'`
    expect(emails).toEqual([{ creator: people.coOwner, keys: 1 }])
    // Made an Owner and demoted again with the same keys, the Owners aren't told twice.
    expect((await gql('owner', 'mutation M($id: ID!) { changeRole(membershipId: $id, role: "owner") }', { id: memberships.coOwner })).code).toBeUndefined()
    expect((await gql('owner', 'mutation M($id: ID!) { changeRole(membershipId: $id, role: "manager") }', { id: memberships.coOwner })).code).toBeUndefined()
    expect(await db.sql`select 1 from outbox where payload->>'template' = 'api-keys-creator-gone'`).toHaveLength(1)
    // Removing a Manager who made no key here tells nobody.
    expect((await gql('owner', 'mutation M($id: ID!) { removeMember(membershipId: $id) }', { id: memberships.coOwner })).code).toBeUndefined()
    expect(await db.sql`select 1 from outbox where payload->>'template' = 'api-keys-creator-gone'`).toHaveLength(1)
  })
})
