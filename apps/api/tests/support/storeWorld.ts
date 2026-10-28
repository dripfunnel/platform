import { graphql, type GraphQLSchema } from 'graphql'
import type postgres from 'postgres'
import type { StoreContext } from '#apis/store/access'
import { storeSchema } from '#apis/store/schema'
import type { SecretBox } from '#auth/secretBox'
import { resolveStoreStanding, storeHeader, supplierHeader } from '#auth/storeCaller'
import { createUserSession, storeCookieName } from '#auth/storeSession'
import { supportCookieName } from '#auth/storeSupport'
import { withSystemScope } from '#db/scoped/index'
import type { DnsLookup } from '#integrations/dns/doh'
import { activityLog } from '#saas/activity/index'
import type { Tenants } from './fixtures'

// The seats ACCESS §11.1's matrix asks for on the Store API, for the cards that test through it: an Owner, a Manager
// and Staff in store A1, a supplier there, and the Owners of A1's sibling store A2 and of partner B's B1.

export type Who = 'owner' | 'manager' | 'staff' | 'supplier' | 'a2Owner' | 'bOwner'
const seats: Record<Who, { email: string; name: string; role: string; store: 'A1' | 'A2' | 'B1'; supplier?: true }> = {
  owner: { email: 'owner@a.example', name: 'Olivia', role: 'owner', store: 'A1' },
  manager: { email: 'manager@a.example', name: 'Mo', role: 'manager', store: 'A1' },
  staff: { email: 'staff@a.example', name: 'Sam', role: 'staff', store: 'A1' },
  supplier: { email: 'anand@a.example', name: 'Anand', role: 'supplier-admin', store: 'A1', supplier: true },
  a2Owner: { email: 'owner@a2.example', name: 'Asha', role: 'owner', store: 'A2' },
  bOwner: { email: 'owner@b.example', name: 'Bea', role: 'owner', store: 'B1' },
}

export interface StoreWorld {
  people: Record<Who, string>
  storeOf: (who: Who) => string
  partnerOf: (who: Who) => string
  gql: (who: Who, source: string, variables?: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null | undefined; code: string | undefined; extensions: Record<string, unknown> | undefined }>
  /** What the Worker hands the Store API for this seat, for the routes that are not GraphQL (uploads). */
  context: (who: Who) => Promise<StoreContext>
  /** The same for a partner's support session, by its cookie. */
  supportContext: (cookie: string, partnerId: string) => Promise<StoreContext>
  /** A partner's support session in a store (ACCESS §8), by its cookie. */
  support: (cookie: string, partnerId: string, source: string, variables?: Record<string, unknown>) => Promise<{ data: Record<string, unknown> | null | undefined; code: string | undefined; extensions: Record<string, unknown> | undefined }>
  /** A bearer credential (an API key or an app's token) on a partner's portal host. */
  bearer: (secret: string, source: string, partnerId: string) => Promise<{ data: Record<string, unknown> | null | undefined; code: string | undefined; extensions: Record<string, unknown> | undefined }>
}

export interface WorldOptions {
  now: () => Date
  secrets: SecretBox | null
  lookup: DnsLookup | null
  studio?: StoreContext['studio']
  /** More of the Store API's dependencies, as the Worker passes them (`preview`, `design`). */
  extra?: Partial<StoreContext>
}

/** The seats, a plan with room for products and staff in each store, and a session each; the supplier works at Catalogue. */
export const seedStoreWorld = async (sql: postgres.Sql, t: Tenants, o: WorldOptions): Promise<StoreWorld> => {
  const stores = { A1: [t.partnerA, t.storeA1], A2: [t.partnerA, t.storeA2], B1: [t.partnerB, t.storeB1] } as const
  await sql`update seller set access_level = 'vendor-catalogue' where id = ${t.sellerA1First}`
  for (const [partnerId, storeId] of Object.values(stores)) {
    const [plan] = await sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${partnerId}, ${`Full ${storeId}`}, 'live') returning id`
    await sql`insert into plan_entitlement (plan_id, partner_id, version, key, amount) values (${plan?.id ?? ''}, ${partnerId}, 1, 'products', 100), (${plan?.id ?? ''}, ${partnerId}, 1, 'staff', 10)`
    await sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${storeId}`
    await sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
      values (${storeId}, ${partnerId}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, ${o.now()}, ${new Date(o.now().getTime() + 30 * 86_400_000)})`
  }
  const people = {} as Record<Who, string>
  const cookies = {} as Record<Who, string>
  for (const [who, seat] of Object.entries(seats) as [Who, (typeof seats)[Who]][]) {
    const [partnerId, storeId] = stores[seat.store]
    const [user] = await sql<{ id: string }[]>`insert into "user" (partner_id, email, name, status) values (${partnerId}, ${seat.email}, ${seat.name}, 'active') returning id`
    people[who] = user?.id ?? ''
    await sql`insert into membership (user_id, store_id, seller_id, role_key, status) values (${people[who]}, ${storeId}, ${seat.supplier ? t.sellerA1First : null}, ${seat.role}, 'active')`
    cookies[who] = await withSystemScope(sql, (tx) => createUserSession(tx, { id: people[who], partnerId }, o.now()))
  }
  const partnerOf = (who: Who) => stores[seats[who].store][0]
  const storeOf = (who: Who) => stores[seats[who].store][1]
  const facts = { requestId: 'r', ip: null, userAgent: null }
  const contextOf = async (headers: Record<string, string>, partnerId: string): Promise<StoreContext> => {
    const standing = await resolveStoreStanding(sql, new Request('https://store.example/api/', { headers }), partnerId, o.now(), activityLog, facts)
    return { standing, partnerId, sql, activity: activityLog, facts, secrets: o.secrets, lookup: o.lookup, domains: { edgeZone: 'dripfunnel.example', localHosts: false, shopDomain: 'shop.example' }, studio: o.studio ?? null, ...o.extra, now: o.now }
  }
  const run = async (headers: Record<string, string>, partnerId: string, source: string, variables: Record<string, unknown> = {}) => {
    const contextValue = await contextOf(headers, partnerId)
    const result = await graphql({ schema: storeSchema as GraphQLSchema, source, contextValue, variableValues: variables })
    return { data: result.data as Record<string, unknown> | null | undefined, code: result.errors?.[0]?.extensions['code'] as string | undefined, extensions: result.errors?.[0]?.extensions }
  }
  return {
    people,
    storeOf,
    partnerOf,
    context: (who) => contextOf({ cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who), ...(seats[who].supplier ? { [supplierHeader]: t.sellerA1First } : {}) }, partnerOf(who)),
    gql: (who, source, variables = {}) =>
      run({ cookie: `${storeCookieName}=${cookies[who]}`, [storeHeader]: storeOf(who), ...(seats[who].supplier ? { [supplierHeader]: t.sellerA1First } : {}) }, partnerOf(who), source, variables),
    supportContext: (cookie, partnerId) => contextOf({ cookie: `${supportCookieName}=${cookie}` }, partnerId),
    support: (cookie, partnerId, source, variables = {}) => run({ cookie: `${supportCookieName}=${cookie}` }, partnerId, source, variables),
    bearer: (secret, source, partnerId) => run({ authorization: `Bearer ${secret}` }, partnerId, source),
  }
}

/** A DNS answer per name, changeable mid-test, as a resolver would answer them. */
export const fakeLookup = (answers: Map<string, string[]>): DnsLookup => ({ resolve: async (host, type) => answers.get(`${type} ${host}`) ?? [] })

export interface Sent {
  url: string
  headers: Record<string, string>
  body: string
}

/** Records every POST and answers each with what `status` says now. */
export const fakeEndpoint = (status: () => number) => {
  const sent: Sent[] = []
  const fetchImpl = (async (input: URL | RequestInfo, init?: RequestInit) => {
    sent.push({ url: String(input), headers: Object.fromEntries(new Headers(init?.headers).entries()), body: String(init?.body ?? '') })
    return new Response(null, { status: status() })
  }) as typeof fetch
  return { sent, fetchImpl }
}
