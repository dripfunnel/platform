import { graphql, type GraphQLSchema } from 'graphql'
import { describe, expect, it } from 'vitest'
import type { StoreCaller, StoreStanding } from '#auth/storeCaller'
import type { StoreRole } from '#auth/storePermissions'
import type { Subscription } from '#core/tenancy'
import { secureSchema } from '../graphql/scope'
import { actingCaller, storePolicy, type StoreContext } from './access'
import { createStoreBuilder, pageInfoType } from './builder'
import { storePage } from './refusals'
import { storeSchema } from './schema'

// The Store API's access policy against a schema of test fields, one per scope (card #288).

const person = { id: 'u1', name: 'Farhan Ali', email: 'farhan@example.test', partnerId: 'p1', sessionHash: 'h' }

const acting = (role: StoreRole, status: Subscription = 'active'): StoreStanding => {
  const caller: StoreCaller = {
    person,
    role,
    membershipId: 'm1',
    store: { id: 's1', name: 'Kesari Threads', status },
    seller: role.side === 'supplier' ? { id: 'v1', name: 'Northwind' } : null,
    plan: null,
    context: { caller: { kind: 'person', userId: 'u1', sessionId: 'h' }, partnerId: 'p1', storeId: 's1', sellerScope: role.side === 'supplier' ? { kind: 'seller', sellerId: 'v1' } : { kind: 'all' }, subscription: status },
  }
  return { kind: 'acting', person, caller }
}

const owner: StoreRole = { side: 'merchant', role: 'owner' }
const staffRole: StoreRole = { side: 'merchant', role: 'staff' }
const stockSupplier: StoreRole = { side: 'supplier', role: 'supplier-member', tier: 'vendor-stock' }
const catalogueSupplier: StoreRole = { side: 'supplier', role: 'supplier-member', tier: 'vendor-catalogue' }

const builder = createStoreBuilder()
const PageInfo = pageInfoType(builder)
const Rows = builder.objectRef<{ nodes: string[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('TestRows').implement({
  fields: (t) => ({ nodes: t.exposeStringList('nodes'), pageInfo: t.field({ type: PageInfo, resolve: (r) => r.pageInfo }) }),
})
builder.queryFields((t) => ({
  whoami: t.string({ extensions: { access: { api: 'store', scope: 'session', permission: null } }, resolve: (_, __, ctx) => (ctx.standing.kind === 'signed-out' ? '' : ctx.standing.person.name) }),
  storeName: t.string({ extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } }, resolve: (_, __, ctx) => actingCaller(ctx).store.name }),
  stock: t.string({ extensions: { access: { api: 'store', scope: 'store-seller', permission: 'stock.read', target: 'none' } }, resolve: (_, __, ctx) => actingCaller(ctx).context.sellerScope.kind }),
  rows: t.field({
    type: Rows,
    args: { first: t.arg.int(), after: t.arg.string() },
    extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.read', target: 'none' } },
    resolve: (_, args) => ({ nodes: Array.from({ length: storePage(args).limit }, (_v, i) => String(i)), pageInfo: { startCursor: null, endCursor: null, hasPreviousPage: false, hasNextPage: false } }),
  }),
}))
builder.mutationType({})
builder.mutationFields((t) => ({
  saveThing: t.string({ extensions: { access: { api: 'store', scope: 'store', permission: 'catalog.write', target: 'none', audit: 'thing.saved' } }, resolve: () => 'saved' }),
  saveOwnProduct: t.string({ extensions: { access: { api: 'store', scope: 'store-seller', permission: 'catalog.write', target: 'none', audit: 'product.updated' } }, resolve: () => 'saved' }),
  countStock: t.string({ extensions: { access: { api: 'store', scope: 'store-seller', permission: 'stock.write', target: 'none', audit: 'stock.adjusted' } }, resolve: () => 'counted' }),
  payNow: t.string({ extensions: { access: { api: 'store', scope: 'store', permission: 'billing', target: 'none', audit: 'billing.paid', whileReadOnly: true } }, resolve: () => 'paid' }),
}))
const schema = secureSchema(builder.toSchema(), storePolicy)

const run = async (source: string, standing: StoreStanding) => {
  const contextValue: StoreContext = { standing, partnerId: 'p', activity: { record: async () => undefined, recordAll: async () => undefined }, sql: null, facts: { requestId: 'r', ip: null, userAgent: null }, now: () => new Date() }
  const result = await graphql({ schema: schema as GraphQLSchema, source, contextValue })
  return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] }
}

describe('the Store API access policy', () => {
  it('refuses a signed-out caller everything but public fields', async () => {
    expect((await run('{ whoami }', { kind: 'signed-out' })).code).toBe('UNAUTHENTICATED')
    expect((await run('{ storeName }', { kind: 'signed-out' })).code).toBe('UNAUTHENTICATED')
  })

  it('answers session fields without a store, and asks for one before store fields', async () => {
    expect((await run('{ whoami }', { kind: 'no-store', person })).data).toEqual({ whoami: 'Farhan Ali' })
    expect((await run('{ storeName }', { kind: 'no-store', person })).code).toBe('STORE_REQUIRED')
    expect((await run('{ stock }', { kind: 'supplier-required', person })).code).toBe('SUPPLIER_REQUIRED')
  })

  it('refuses a store the session doesn’t hold with FORBIDDEN, never as missing', async () => {
    expect((await run('{ storeName }', { kind: 'crossing', person })).code).toBe('FORBIDDEN')
  })

  it('refuses every store field of a suspended store', async () => {
    expect((await run('{ storeName }', acting(owner, 'suspended'))).code).toBe('STORE_SUSPENDED')
  })

  it('keeps merchant-side fields from suppliers, and admits them to store-seller fields scoped to their rows', async () => {
    expect((await run('{ storeName }', acting(stockSupplier))).code).toBe('FORBIDDEN')
    expect((await run('{ stock }', acting(stockSupplier))).data).toEqual({ stock: 'seller' })
    expect((await run('{ stock }', acting(owner))).data).toEqual({ stock: 'all' })
  })

  it('refuses a role without the permission', async () => {
    expect((await run('mutation { saveThing }', acting(staffRole))).code).toBe('FORBIDDEN')
    expect((await run('mutation { saveThing }', acting(owner))).data).toEqual({ saveThing: 'saved' })
  })

  it('refuses writes while past due or cancelled, but reads and the few declared writes go on', async () => {
    for (const status of ['past_due', 'cancelled'] as const) {
      expect((await run('mutation { saveThing }', acting(owner, status))).code).toBe('READ_ONLY')
      expect((await run('{ storeName }', acting(owner, status))).data).toEqual({ storeName: 'Kesari Threads' })
      expect((await run('mutation { payNow }', acting(owner, status))).data).toEqual({ payNow: 'paid' })
    }
  })

  it('lets a supplier keep its stock and shipping going while the store is past due, nothing else, and nothing once cancelled (FIRST-RELEASE §1)', async () => {
    expect((await run('mutation { countStock }', acting(stockSupplier, 'past_due'))).data).toEqual({ countStock: 'counted' })
    expect((await run('mutation { saveOwnProduct }', acting(catalogueSupplier, 'past_due'))).code).toBe('READ_ONLY')
    expect((await run('mutation { saveOwnProduct }', acting(catalogueSupplier))).data).toEqual({ saveOwnProduct: 'saved' })
    expect((await run('mutation { countStock }', acting(stockSupplier, 'cancelled'))).code).toBe('READ_ONLY')
  })

  it('pages at most 50 and refuses a cursor it didn’t make', async () => {
    const big = await run('{ rows(first: 500) { nodes } }', acting(owner))
    expect((big.data?.['rows'] as { nodes: string[] }).nodes).toHaveLength(50)
    expect((await run('{ rows(after: "nope") { nodes } }', acting(owner))).code).toBe('INVALID_CURSOR')
  })
})

describe('the Store API schema', () => {
  it('builds, so every field on it declares its access', () => {
    expect(storeSchema.getQueryType()?.getFields()['health']).toBeDefined()
  })

  it('refuses to build with a field that declares no access, or another API’s scope', () => {
    const undeclared = createStoreBuilder()
    undeclared.queryFields((t) => ({ leak: t.string({ resolve: () => 'x' }) }))
    expect(() => secureSchema(undeclared.toSchema(), storePolicy)).toThrow(/declares no access/)
    const partnerScoped = createStoreBuilder()
    partnerScoped.queryFields((t) => ({ leak: t.string({ extensions: { access: { api: 'store', scope: 'partner', permission: 'catalog.read', target: 'none' } }, resolve: () => 'x' }) }))
    expect(() => secureSchema(partnerScoped.toSchema(), storePolicy)).toThrow(/does not serve/)
  })
})

describe('a partner support session (ACCESS.md §8, #331)', () => {
  const supportAs = (access: 'read' | 'write'): StoreStanding => {
    const standing = acting(owner)
    if (standing.kind !== 'acting') throw new Error('acting')
    const support = { sessionId: 'ss1', agent: { id: 'pu1', name: 'Priya' }, partnerName: 'Northstar', actingAs: 'Farhan Ali', access, expiresAt: new Date() }
    return { ...standing, caller: { ...standing.caller, support, context: { ...standing.caller.context, caller: { kind: 'support', supportSessionId: 'ss1', partnerUserId: 'pu1', access } } } }
  }

  it('refuses a person’s own fields, and every write until the store allows it', async () => {
    expect((await run('{ whoami }', supportAs('write'))).code).toBe('BLOCKED_FOR_SUPPORT')
    expect((await run('mutation { saveThing }', supportAs('read'))).code).toBe('SUPPORT_READ_ONLY')
    expect((await run('mutation { payNow }', supportAs('read'))).code).toBe('BLOCKED_FOR_SUPPORT')
    expect((await run('mutation { saveThing }', supportAs('write'))).data).toEqual({ saveThing: 'saved' })
  })

  it('lists the writes an elevated session acting as an Owner is still refused', async () => {
    const ctx: StoreContext = { standing: supportAs('write'), partnerId: 'p1', activity: { record: async () => undefined, recordAll: async () => undefined }, sql: null, facts: { requestId: 'r', ip: null, userAgent: null }, now: () => new Date() }
    const refused: string[] = []
    for (const field of Object.values(storeSchema.getMutationType()?.getFields() ?? {})) {
      const access = field.extensions.access
      if (!access) continue
      const code = await storePolicy.authorize(access, ctx, {}, 'mutation', { name: field.name, root: true }).then(
        () => null,
        (error: { extensions?: { code?: string } }) => error.extensions?.code ?? null,
      )
      if (code === 'BLOCKED_FOR_SUPPORT') refused.push(field.name)
    }
    // A change here is a change to ACCESS.md §8's "never" list.
    expect(refused.sort()).toMatchSnapshot()
  })
})
