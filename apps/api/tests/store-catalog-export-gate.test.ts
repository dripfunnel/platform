import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { StoreContext } from '#apis/store/access'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #301: the export resolver's own check (`exports`, `exports.products`) is what keeps a seat without it from taking
// the catalogue out. Every seat has it today (ACCESS §5.2), so this table takes it away, leaving every other permission.
vi.mock('#auth/storePermissions', async (actual) => {
  const real = await actual<typeof import('#auth/storePermissions')>()
  return { ...real, storeRoleHas: (role: Parameters<typeof real.storeRoleHas>[0], p: Parameters<typeof real.storeRoleHas>[1]) => p !== 'exports' && p !== 'exports.products' && real.storeRoleHas(role, p) }
})

const { storeSchema } = await import('#apis/store/schema')

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-06T09:00:00Z')
const cookies = { owner: '', supplier: '' }

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  const user = async (email: string) => (await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email}, 'active') returning id`)[0]?.id ?? ''
  const owner = await user('owner@a.example')
  const supplier = await user('anand@a.example')
  await db.sql`insert into membership (user_id, store_id, role_key, status) values (${owner}, ${t.storeA1}, 'owner', 'active')`
  await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${supplier}, ${t.storeA1}, ${t.sellerA1First}, 'supplier-admin', 'active')`
  cookies.owner = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: owner, partnerId: t.partnerA }, now))
  cookies.supplier = await withSystemScope(db.sql, (tx) => createUserSession(tx, { id: supplier, partnerId: t.partnerA }, now))
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const gql = async (source: string, who: 'owner' | 'supplier') => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = { cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: t.storeA1, ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}) }
  const standing = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, now, activityLog, facts)
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return result.errors?.[0]?.extensions['code'] as string | undefined
}

describe('the export’s own permission check', () => {
  it('refuses a merchant seat without `exports` and a supplier without `exports.products`, on every export field', async () => {
    for (const who of ['owner', 'supplier'] as const) {
      expect(await gql('mutation { requestCatalogExport(kind: products) }', who), who).toBe('FORBIDDEN')
      expect(await gql('{ catalogExports { id } }', who), who).toBe('FORBIDDEN')
      expect(await gql('{ catalogExport(id: "00000000-0000-4000-8000-000000000000") { id } }', who), who).toBe('FORBIDDEN')
    }
    expect((await db.sql`select 1 from catalog_export`).length).toBe(0)
  })

  it('still lets the same seats read the catalogue, so the refusal is the export check’s alone', async () => {
    for (const who of ['owner', 'supplier'] as const) expect(await gql('{ products(first: 1) { nodes { id } } }', who), who).toBeUndefined()
  })
})
