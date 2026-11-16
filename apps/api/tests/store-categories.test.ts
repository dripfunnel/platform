import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { StaffMember, StaffRole } from '#auth/staff'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { withSystemScope } from '#db/scoped/index'
import { activityLog } from '#saas/activity/index'
import { createStoreCategoryAdminService } from '#saas/storeCategories/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Store categories (DATA-MODEL §7.2): staff keep the list (Super admin writes, everyone reads); a store's Owner picks
// one, never a Manager, a supplier or a read-only support session, and only for its own store.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-11-16T06:00:00Z')
const request = new Request('https://admin.dripfunnel.ai/api', { headers: { 'cf-ray': 'ray-test' } })
const staff = new Map<StaffRole, StaffMember>()
type Who = 'owner' | 'manager' | 'supplier' | 'other'
const cookies = {} as Record<Who, string>

const admin = async <T = Record<string, unknown>>(source: string, role: StaffRole, variables: Record<string, unknown> = {}) => {
  const member = staff.get(role) ?? null
  const contextValue: AdminContext = {
    staff: member,
    isAssigned: (id, target) => isAssigned(db.sql, id, target),
    staffActivity: null,
    partners: null,
    stores: null,
    customers: null,
    staffSessions: null,
    provisioning: null,
    dashboard: null,
    staffMembers: null,
    storeCategories: member ? createStoreCategoryAdminService({ sql: db.sql, staff: member, facts: factsOf(request), activity: activityLog, now: () => now }) : null,
  }
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  return { data: result.data as T | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

const shop = async (source: string, who: Who, as: { support?: 'read' } = {}) => {
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const headers: Record<string, string> = {
    cookie: `${storeCookieName}=${cookies[who]}`,
    [storeHeader]: who === 'other' ? t.storeA2 : t.storeA1,
    ...(who === 'supplier' ? { [supplierHeader]: t.sellerA1First } : {}),
  }
  const resolved = await resolveStoreStanding(db.sql, new Request('https://store.example/api/', { headers }), t.partnerA, new Date(), activityLog, facts)
  const standing =
    as.support && resolved.kind === 'acting'
      ? {
          ...resolved,
          caller: {
            ...resolved.caller,
            context: { ...resolved.caller.context, caller: { kind: 'support' as const, supportSessionId: crypto.randomUUID(), partnerUserId: crypto.randomUUID(), access: as.support } },
            support: { sessionId: crypto.randomUUID(), agent: { id: crypto.randomUUID(), name: 'Priya' }, partnerName: 'Partner A', actingAs: 'Owner', access: as.support, expiresAt: new Date(Date.now() + 3_600_000), extendable: true, writeRequest: null },
          },
        }
      : resolved
  const contextValue: StoreContext = { standing, partnerId: t.partnerA, sql: db.sql, activity: activityLog, facts, now: () => now }
  const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined }
}

type Category = { id: string; key: string; names: { language: string; name: string }[]; sections: string[]; archivedAt: string | null; storeCount: number }
const fields = 'id key names { language name } sections archivedAt storeCount'
const create = `mutation($input: StoreCategoryInput!, $reason: String!) { createStoreCategory(input: $input, reason: $reason) { ${fields} } }`
const update = `mutation($id: ID!, $input: StoreCategoryInput!, $reason: String!) { updateStoreCategory(id: $id, input: $input, reason: $reason) { ${fields} } }`
const archive = `mutation($id: ID!, $archived: Boolean!, $reason: String!) { archiveStoreCategory(id: $id, archived: $archived, reason: $reason) { ${fields} } }`
const list = `{ storeCategories { ${fields} } }`
const choose = (id: string) => `mutation { chooseShopCategory(id: "${id}") { key name } }`
const categoryOf = async (storeId: string) => (await db.sql<{ key: string | null }[]>`select c.key from store s left join store_category c on c.id = s.category_id where s.id = ${storeId}`)[0]?.key ?? null

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  for (const role of ['staff-super-admin', 'staff-support', 'staff-partner-manager'] as const) {
    const [row] = await db.sql<{ id: string }[]>`insert into staff_user (sso_subject, email, name, role_key, status) values (${role}, ${`${role}@dripfunnel.example`}, ${role}, ${role}, 'active') returning id`
    staff.set(role, { id: row?.id ?? '', email: `${role}@dripfunnel.example`, name: role, role })
  }
  const person = async (email: string, storeId: string, role: string, seller: string | null = null) => {
    const [u] = await db.sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${t.partnerA}, ${email}, ${email.split('@')[0] ?? ''}, 'active') returning id`
    await db.sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${u?.id ?? ''}, ${storeId}, ${seller}, ${role}, 'active')`
    return withSystemScope(db.sql, (tx) => createUserSession(tx, { id: u?.id ?? '', partnerId: t.partnerA }, new Date()))
  }
  cookies.owner = await person('owner@a1.example', t.storeA1, 'owner')
  cookies.manager = await person('manager@a1.example', t.storeA1, 'manager')
  cookies.supplier = await person('anand@a1.example', t.storeA1, 'supplier-admin', t.sellerA1First)
  cookies.other = await person('owner@a2.example', t.storeA2, 'owner')
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('the staff list', () => {
  it('is seeded with the thirty categories, General first, and every role reads it', async () => {
    const all = (await admin<{ storeCategories: Category[] }>(list, 'staff-support')).data?.storeCategories ?? []
    expect(all).toHaveLength(30)
    expect(all[0]).toMatchObject({ key: 'general', names: [{ language: 'en', name: 'General' }], archivedAt: null, storeCount: 0 })
    expect(all.at(-1)?.key).toBe('religious_spiritual')
  })

  it('is Super admin only to change, each change logged with its reason', async () => {
    const input = { names: [{ language: 'en', name: 'Musical Instruments' }, { language: 'hi', name: 'वाद्य यंत्र' }], sections: ['specs', 'faqs'] }
    expect((await admin(create, 'staff-partner-manager', { input, reason: 'Merchants asked' })).code).toBe('FORBIDDEN')
    const made = (await admin<{ createStoreCategory: Category }>(create, 'staff-super-admin', { input, reason: 'Merchants asked' })).data?.createStoreCategory
    expect(made).toMatchObject({ key: 'musical_instruments', sections: ['specs', 'faqs'], storeCount: 0 })
    expect((await admin(create, 'staff-super-admin', { input, reason: 'Again' })).code).toBe('KEY_TAKEN')

    const renamed = { names: [{ language: 'en', name: 'Music & Instruments' }], sections: ['specs'] }
    const edited = (await admin<{ updateStoreCategory: Category }>(update, 'staff-super-admin', { id: made?.id, input: renamed, reason: 'Clearer name' })).data?.updateStoreCategory
    expect(edited).toMatchObject({ key: 'musical_instruments', names: [{ language: 'en', name: 'Music & Instruments' }], sections: ['specs'] })

    const [entry] = await db.sql<{ reason: string; changes: unknown }[]>`select reason, changes from activity_log where action = 'store_category.updated' and target_id = ${made?.id ?? ''}`
    expect(entry?.reason).toBe('Clearer name')
  })

  it('refuses a name with no English, an unknown section, an empty reason and an unknown field', async () => {
    const run = (input: Record<string, unknown>, reason = 'r') => admin(create, 'staff-super-admin', { input, reason })
    expect((await run({ names: [{ language: 'hi', name: 'केवल' }], sections: [] })).code).toBe('INVALID_INPUT')
    expect((await run({ names: [{ language: 'en', name: 'X' }], sections: ['nope'] })).data?.['createStoreCategory'] ?? null).toBeNull()
    expect((await run({ names: [{ language: 'en', name: 'Fine' }], sections: [] }, '  ')).code).toBe('INVALID_INPUT')
    expect((await run({ names: [{ language: 'en', name: 'Fine', extra: 1 }], sections: [] })).data?.['createStoreCategory'] ?? null).toBeNull()
  })
})

describe('a store’s choice', () => {
  const ids = async () => Object.fromEntries(((await admin<{ storeCategories: Category[] }>(list, 'staff-super-admin')).data?.storeCategories ?? []).map((c) => [c.key, c.id]))

  it('is the Owner’s, shows on Home’s checklist, and is logged', async () => {
    const id = (await ids())['footwear'] ?? ''
    const setup = async (who: Who) => ((await shop('{ home { setup { category } } }', who)).data?.['home'] as { setup: { category: boolean | null } | null } | undefined)?.setup
    expect(await setup('owner')).toEqual({ category: false })
    expect(await setup('manager')).toEqual({ category: null })
    expect((await shop(choose(id), 'manager')).code).toBe('FORBIDDEN')
    expect((await shop(choose(id), 'owner')).data).toEqual({ chooseShopCategory: { key: 'footwear', name: 'Footwear' } })
    expect(await setup('owner')).toEqual({ category: true })
    expect(await categoryOf(t.storeA1)).toBe('footwear')
    expect((await db.sql`select 1 from activity_log where action = 'store.category_chosen' and store_id = ${t.storeA1}`).length).toBe(1)
  })

  it('is never a supplier’s, a read-only support session’s, or another store’s (isolation matrix)', async () => {
    const id = (await ids())['watches'] ?? ''
    expect((await shop('{ shopCategory { current { key } } }', 'supplier')).code).toBe('FORBIDDEN')
    expect((await shop(choose(id), 'supplier')).code).toBe('FORBIDDEN')
    expect((await shop(choose(id), 'owner', { support: 'read' })).code).toBeDefined()
    expect(await categoryOf(t.storeA1)).toBe('footwear')
    await shop(choose(id), 'other')
    expect(await categoryOf(t.storeA2)).toBe('watches')
    expect(await categoryOf(t.storeA1)).toBe('footwear')
  })

  it('keeps an archived category on the stores that chose it, out of everyone else’s picker', async () => {
    const id = (await ids())['footwear'] ?? ''
    const archived = (await admin<{ archiveStoreCategory: Category }>(archive, 'staff-super-admin', { id, archived: true, reason: 'Merged into Fashion' })).data?.archiveStoreCategory
    expect(archived?.storeCount).toBe(1)
    expect(archived?.archivedAt).not.toBeNull()

    const picker = async (who: Who) => (await shop('{ shopCategory { options { key archived } current { key archived } } }', who)).data?.['shopCategory'] as { options: { key: string; archived: boolean }[]; current: { key: string; archived: boolean } | null }
    const mine = await picker('owner')
    expect(mine.current).toEqual({ key: 'footwear', archived: true })
    expect(mine.options.some((o) => o.key === 'footwear')).toBe(true)
    expect((await picker('other')).options.some((o) => o.key === 'footwear')).toBe(false)
    expect((await shop(choose(id), 'other')).code).toBe('NOT_FOUND')
    expect(await categoryOf(t.storeA1)).toBe('footwear')

    await admin(archive, 'staff-super-admin', { id, archived: false, reason: 'Back by request' })
    expect((await picker('other')).options.some((o) => o.key === 'footwear')).toBe(true)
  })
})
