import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { DnsLookup } from '#integrations/dns/doh'
import { customDomainRecheckDeliverer } from '#jobs/queues/deliverers/customDomainRecheck'
import { lookupLiveHost } from '#saas/storefronts/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #471 (SAPI 17b), part 2: Site settings › Domains on the Store API (SAAS §8 "The merchant's side"): the free
// address, one domain of the store's own on a paid plan, made primary or removed, each change purging the edge's lookup.

let db: TestDatabase
let t: Tenants
let w: StoreWorld
// A second passes with every reading, so each change is its own moment, as it would be.
let clock = new Date('2026-10-11T09:00:00.000Z')
const now = () => (clock = new Date(clock.getTime() + 1000))
const edge = 'shops.edge.dripfunnel.example'
const own = 'www.juniper.example'

type Domain = { id: string | null; host: string; kind: string; status: string; primary: boolean; records: { type: string; name: string; value: string; found: string | null }[] }
const domainsOf = async (who: Who) =>
  (await w.gql(who, '{ storefrontDomains { customDomainAllowed domains { id host kind status primary records { type name value found } } } }')).data?.['storefrontDomains'] as { customDomainAllowed: boolean; domains: Domain[] }
const connect = (who: Who, host: string) => w.gql(who, 'mutation C($h: String!) { connectDomain(host: $h) { id host status primary records { type name value } } }', { h: host })
const op = (who: Who, name: 'checkDomain' | 'removeDomain' | 'makeDomainPrimary', id: string | null) => w.gql(who, `mutation M($id: ID${name === 'makeDomainPrimary' ? '' : '!'}) { ${name}(id: $id) }`, { id })
const outbox = (storeId: string, kind: string) => db.sql<{ payload: Record<string, unknown> }[]>`select payload from outbox where store_id = ${storeId} and kind = ${kind} order by created_at, id`
const codeOf = async (storeId: string) => (await db.sql<{ code: string }[]>`select code from store where id = ${storeId}`)[0]?.code ?? ''

/** DNS as the merchant set it: the CNAME to this partner's edge. */
const pointed: DnsLookup = { resolve: async (_host, type) => (type === 'CNAME' ? [edge] : []) }
const goLive = async (storeId: string, id: string) =>
  customDomainRecheckDeliverer(db.sql, pointed, now, null).deliver({ payload: { storeId, customDomainId: id } } as never, new AbortController().signal)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  w = await seedStoreWorld(db.sql, t, { now, secrets: null, lookup: null })
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`update store set status = 'active' where id in (${t.storeA1}, ${t.storeA2}, ${t.storeB1})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x'), (${t.partnerA}, 'portal', 'store.acme.example', 'live', 'CNAME', 'x')`
  // A1 and B1 are on a plan with their own domain; A2's has none.
  for (const storeId of [t.storeA1, t.storeB1]) {
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) select plan_id, partner_id, 1, 'custom_domain', true from store_subscription where store_id = ${storeId}`
  }
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

describe('the store’s addresses', () => {
  it('list the free address first, primary and live; the Manager reads them; Staff and a supplier are refused', async () => {
    const free = `${await codeOf(t.storeA1)}.shops.acme.example`
    expect(await domainsOf('owner')).toEqual({ customDomainAllowed: true, domains: [{ id: null, host: free, kind: 'free', status: 'live', primary: true, records: [] }] })
    expect((await domainsOf('manager')).domains.map((d) => d.host)).toEqual([free])
    expect((await domainsOf('a2Owner')).customDomainAllowed).toBe(false)
    for (const who of ['staff', 'supplier'] as const) expect((await w.gql(who, '{ storefrontDomains { customDomainAllowed } }')).code).toBe('FORBIDDEN')
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      expect((await connect(who, own)).code).toBe('FORBIDDEN')
      expect((await op(who, 'makeDomainPrimary', null)).code).toBe('FORBIDDEN')
    }
  })
})

describe('connecting a domain', () => {
  it('is refused on a plan without it, with the plan that unlocks it, and nothing is written', async () => {
    const r = await connect('a2Owner', 'www.a2.example')
    expect([r.code, r.extensions?.['key']]).toEqual(['PLAN_LIMIT', 'custom_domain'])
    expect(await db.sql`select 1 from custom_domain where store_id = ${t.storeA2}`).toHaveLength(0)
  })

  it('refuses what isn’t a domain the merchant may own: a bare domain, ours, a partner’s address, or one under it', async () => {
    const refused = async (host: string) => {
      const r = await connect('owner', host)
      return [r.code, r.extensions?.['suggested'] ?? null]
    }
    expect(await refused('juniper.example')).toEqual(['APEX_NOT_AVAILABLE', 'www.juniper.example'])
    expect(await refused('not a host')).toEqual(['INVALID_HOSTNAME', null])
    expect(await refused('*.juniper.example')).toEqual(['INVALID_HOSTNAME', null])
    expect(await refused('127.0.0.1')).toEqual(['INVALID_HOSTNAME', null])
    expect(await refused('shop.dripfunnel.com')).toEqual(['DRIPFUNNEL_DOMAIN', null])
    expect(await refused('shop.dripfunnel.example')).toEqual(['DRIPFUNNEL_DOMAIN', null])
    expect(await refused(`${await codeOf(t.storeA2)}.shops.acme.example`)).toEqual(['DOMAIN_TAKEN', null])
    expect(await refused('store.acme.example')).toEqual(['DOMAIN_TAKEN', null])
    expect(await db.sql`select 1 from custom_domain`).toHaveLength(0)
  })

  it('connects one, shows the records to add, queues its first check, and refuses a second while it waits', async () => {
    const r = await connect('owner', `https://${own.toUpperCase()}/shop?x=1`)
    expect(r.code).toBeUndefined()
    const domain = r.data?.['connectDomain'] as { id: string; host: string; status: string; primary: boolean; records: { type: string; name: string; value: string }[] }
    expect(domain).toMatchObject({ host: own, status: 'waiting', primary: false })
    expect(domain.records[0]).toEqual({ type: 'CNAME', name: own, value: edge })
    expect(domain.records[1]).toMatchObject({ type: 'TXT', name: `_df-verify.${own}` })
    expect(domain.records[1]?.value).toMatch(/^df-verify=[0-9a-f]{32}$/)
    expect((await outbox(t.storeA1, 'custom_domain.recheck')).map((o) => o.payload)).toEqual([{ storeId: t.storeA1, customDomainId: domain.id }])
    expect((await connect('owner', 'shop.other-juniper.example')).code).toBe('DOMAIN_PENDING')
    // Another store can't take it, and never learns more than that.
    expect((await connect('bOwner', own)).code).toBe('DOMAIN_TAKEN')
    const logged = await db.sql<{ action: string; target_label: string; visibility: string }[]>`select action, target_label, visibility from activity_log where store_id = ${t.storeA1} and action like 'custom_domain.%'`
    expect(logged).toEqual([{ action: 'custom_domain.connected', target_label: own, visibility: 'partner' }])
  })

  it('“Check now” queues a check, once a minute, and only on the store’s own domain', async () => {
    const [domain] = await db.sql<{ id: string }[]>`select id from custom_domain where store_id = ${t.storeA1}`
    const id = domain?.id ?? ''
    expect((await op('owner', 'checkDomain', id)).data?.['checkDomain']).toBe(true)
    expect(await outbox(t.storeA1, 'custom_domain.recheck')).toHaveLength(2)
    expect((await op('bOwner', 'checkDomain', id)).code).toBe('NOT_FOUND')
    expect((await op('manager', 'checkDomain', id)).code).toBe('FORBIDDEN')
    await db.sql`update custom_domain set checked_at = ${new Date(clock.getTime() - 30_000)} where id = ${id}`
    expect((await op('owner', 'checkDomain', id)).code).toBe('TOO_SOON')
    await db.sql`update custom_domain set checked_at = null where id = ${id}`
  })
})

describe('a connected domain', () => {
  let id = ''
  const purges = async (storeId: string) => (await outbox(storeId, 'cache.purge')).map((o) => o.payload)

  it('is made primary only once live; then the edge sends the other addresses to it, and the edge’s lookup is purged', async () => {
    id = (await db.sql<{ id: string }[]>`select id from custom_domain where store_id = ${t.storeA1}`)[0]?.id ?? ''
    expect((await op('owner', 'makeDomainPrimary', id)).code).toBe('DOMAIN_NOT_LIVE')
    await goLive(t.storeA1, id)
    expect(await purges(t.storeA1)).toEqual([{ storeId: t.storeA1, host: own, reason: 'domain-live' }])
    expect((await connect('owner', 'shop.second-juniper.example')).code).toBe('DOMAIN_LIMIT')
    expect((await op('bOwner', 'makeDomainPrimary', id)).code).toBe('NOT_FOUND')

    expect((await op('owner', 'makeDomainPrimary', id)).data?.['makeDomainPrimary']).toBe(true)
    expect((await domainsOf('owner')).domains.map((d) => [d.kind, d.status, d.primary])).toEqual([['free', 'live', false], ['custom', 'live', true]])
    expect((await purges(t.storeA1)).at(-1)).toEqual({ storeId: t.storeA1, host: own, reason: 'domain-primary' })
    const free = `${await codeOf(t.storeA1)}.shops.acme.example`
    expect(await lookupLiveHost(db.sql, free, { localhost: false })).toMatchObject({ kind: 'store', storeId: t.storeA1, primaryHost: own })
    expect(await lookupLiveHost(db.sql, own, { localhost: false })).toMatchObject({ kind: 'store', storeId: t.storeA1, primaryHost: own })
    // Made primary again, nothing changes and nothing is purged.
    const count = (await purges(t.storeA1)).length
    await op('owner', 'makeDomainPrimary', id)
    expect(await purges(t.storeA1)).toHaveLength(count)

    // The free address back as primary.
    expect((await op('owner', 'makeDomainPrimary', null)).data?.['makeDomainPrimary']).toBe(true)
    expect((await domainsOf('owner')).domains.map((d) => d.primary)).toEqual([true, false])
    expect(await lookupLiveHost(db.sql, own, { localhost: false })).toMatchObject({ primaryHost: free })
    expect(await purges(t.storeA1)).toHaveLength(count + 1)
    await op('owner', 'makeDomainPrimary', id)
    // No other store's lookup was purged.
    expect([await purges(t.storeA2), await purges(t.storeB1)]).toEqual([[], []])
    const logged = await db.sql<{ action: string; target_label: string }[]>`select action, target_label from activity_log where store_id = ${t.storeA1} and action = 'custom_domain.made_primary' order by occurred_at, id`
    expect(logged.map((l) => l.target_label)).toEqual([own, free, own])
  })

  it('is refused while the store is past due', async () => {
    await db.sql`update store set status = 'past_due' where id = ${t.storeA1}`
    try {
      expect((await op('owner', 'removeDomain', id)).code).toBe('READ_ONLY')
      expect((await op('owner', 'makeDomainPrimary', null)).code).toBe('READ_ONLY')
      expect((await connect('owner', 'shop.late.example')).code).toBe('READ_ONLY')
      expect((await domainsOf('owner')).domains).toHaveLength(2)
    } finally {
      await db.sql`update store set status = 'active' where id = ${t.storeA1}`
    }
  })

  it('is removed: shoppers on it no longer reach the shop, Cloudflare lets it go, the free address is primary again, and it can be connected again', async () => {
    expect((await op('bOwner', 'removeDomain', id)).code).toBe('NOT_FOUND')
    expect((await op('owner', 'removeDomain', id)).data?.['removeDomain']).toBe(true)
    expect((await domainsOf('owner')).domains.map((d) => [d.kind, d.primary])).toEqual([['free', true]])
    expect((await outbox(t.storeA1, 'domain.remove')).map((o) => o.payload)).toEqual([{ host: own }])
    expect((await purges(t.storeA1)).at(-1)).toEqual({ storeId: t.storeA1, host: own, reason: 'domain-removed' })
    expect(await lookupLiveHost(db.sql, own, { localhost: false })).toEqual({ kind: 'none' })
    expect([await purges(t.storeA2), await purges(t.storeB1)]).toEqual([[], []])
    expect((await db.sql<{ action: string }[]>`select action from activity_log where store_id = ${t.storeA1} and action = 'custom_domain.removed'`).map((l) => l.action)).toEqual(['custom_domain.removed'])
    // A waiting domain is cancelled the same way.
    const again = await connect('owner', own)
    expect(again.code).toBeUndefined()
    expect((await op('owner', 'removeDomain', String((again.data?.['connectDomain'] as { id: string }).id))).data?.['removeDomain']).toBe(true)
    expect(await db.sql`select 1 from custom_domain where store_id = ${t.storeA1}`).toHaveLength(0)
  })
})
