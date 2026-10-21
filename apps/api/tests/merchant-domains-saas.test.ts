import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { CloudflareRefused, CloudflareUnavailable, type CloudflareApi, type CustomHostname } from '#integrations/cloudflare/api'
import type { DnsLookup } from '#integrations/dns/doh'
import { customDomainRecheckDeliverer } from '#jobs/queues/deliverers/customDomainRecheck'
import { domainRemoveDeliverer } from '#jobs/queues/deliverers/domainRemove'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { queueMerchantDomainRemoval } from '#saas/domains/index'
import { queueSideEffect } from '#saas/outbox/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #468: a merchant's own domain goes live through Cloudflare for SaaS, as a portal host does (SAAS §8).

let db: TestDatabase
const now = new Date('2026-10-11T09:00:00Z')
const edge = 'shops.edge.example'
type Domain = { id: string; storeId: string; partnerId: string; host: string; token: string }
// Two stores of one partner, and one of another partner.
const domains: Record<'mine' | 'sibling' | 'other', Domain> = {
  mine: { id: '', storeId: '', partnerId: '', host: 'shop.mine.example', token: 'df-verify=mine' },
  sibling: { id: '', storeId: '', partnerId: '', host: 'shop.sibling.example', token: 'df-verify=sibling' },
  other: { id: '', storeId: '', partnerId: '', host: 'shop.other.example', token: 'df-verify=other' },
}

const hostname = (status: string, ssl: string): CustomHostname => ({ id: 'h1', hostname: 'x', status, ssl: { status: ssl } })

const fakeCloudflare = (answer: () => Promise<CustomHostname>) => {
  const api = {
    ensured: [] as string[],
    removed: [] as string[],
    ensureHostname: async (host: string) => (api.ensured.push(host), answer()),
    removeHostname: async (host: string) => void api.removed.push(host),
  }
  return api
}

/** DNS as the merchant set it: the CNAME to our edge and the ownership TXT, once `passes`. */
const dns = (passes: boolean, onResolve?: () => Promise<unknown>): DnsLookup => ({
  resolve: async (host, type) => {
    await onResolve?.()
    if (!passes) return []
    const d = Object.values(domains).find((x) => host === x.host || host === `_df-verify.${x.host}`)
    return type === 'CNAME' ? [edge] : d ? [d.token] : []
  },
})

const recheck = (d: Domain, lookup: DnsLookup, cloudflare: CloudflareApi | null, storeId = d.storeId) =>
  customDomainRecheckDeliverer(db.sql, lookup, () => now, cloudflare).deliver({ payload: { storeId, customDomainId: d.id } } as never, new AbortController().signal)

const rowOf = async (d: Domain) =>
  (await db.sql<{ status: string; checked_at: Date | null }[]>`select status, checked_at from custom_domain where id = ${d.id}`)[0]

const purgesFor = (d: Domain) =>
  db.sql<{ payload: { storeId: string; host: string; reason: string } }[]>`select payload from outbox where kind = 'cache.purge' and store_id = ${d.storeId} order by created_at`

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const partnerOf = async (name: string) => (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  const ns = await partnerOf('Northstar Commerce')
  const bz = await partnerOf('Bazaar Cloud')
  const free = (partnerId: string, n: number) =>
    db.sql<{ id: string }[]>`select id from store where partner_id = ${partnerId} and id not in (select store_id from custom_domain) order by name limit ${n}`
  const [a, b] = await free(ns, 2)
  const [c] = await free(bz, 1)
  for (const [d, store, partnerId] of [[domains.mine, a, ns], [domains.sibling, b, ns], [domains.other, c, bz]] as const) {
    d.storeId = store?.id ?? ''
    d.partnerId = partnerId
  }
}, 120_000)

beforeEach(async () => {
  await db.sql`delete from outbox where kind in ('cache.purge', 'domain.remove', 'custom_domain.recheck')`
  for (const d of Object.values(domains)) {
    await db.sql`delete from custom_domain where id = ${d.id || null} or lower(host) = ${d.host}`
    d.id = (await db.sql<{ id: string }[]>`
      insert into custom_domain (store_id, host, status, expected_cname, ownership_token) values (${d.storeId}, ${d.host}, 'waiting', ${edge}, ${d.token}) returning id`)[0]?.id ?? ''
  }
})

afterAll(async () => {
  await db?.drop()
})

describe('registering a merchant domain with Cloudflare for SaaS', () => {
  it('registers nothing before DNS passes, then follows Cloudflare to live and purges the edge lookup once', async () => {
    const waiting = fakeCloudflare(async () => hostname('pending', 'initializing'))
    await recheck(domains.mine, dns(false), waiting)
    expect(waiting.ensured).toEqual([])
    expect((await rowOf(domains.mine))?.status).toBe('waiting')

    await recheck(domains.mine, dns(true), waiting)
    expect(waiting.ensured).toEqual([domains.mine.host])
    expect((await rowOf(domains.mine))?.status).toBe('verifying')
    await recheck(domains.mine, dns(true), fakeCloudflare(async () => hostname('active', 'pending_issuance')))
    expect((await rowOf(domains.mine))?.status).toBe('issuing')
    expect(await purgesFor(domains.mine)).toEqual([])

    await recheck(domains.mine, dns(true), fakeCloudflare(async () => hostname('active', 'active')))
    expect((await rowOf(domains.mine))?.status).toBe('live')
    await recheck(domains.mine, dns(true), fakeCloudflare(async () => hostname('active', 'active')))
    expect((await purgesFor(domains.mine)).map((r) => r.payload)).toEqual([{ storeId: domains.mine.storeId, host: domains.mine.host, reason: 'domain-live' }])

    const changes = await db.sql<{ changes: { before: string; after: string }[] }[]>`
      select changes from activity_log where action = 'store.domain_status_changed' and target_id = ${domains.mine.id} order by occurred_at, id`
    expect(changes.map((c) => c.changes[0]?.after)).toEqual(['verifying', 'issuing', 'live'])
  })

  it('keeps the DNS answer as the state where no Cloudflare client is configured', async () => {
    await recheck(domains.mine, dns(true), null)
    expect((await rowOf(domains.mine))?.status).toBe('live')
  })

  it('rethrows when Cloudflare is down so the outbox retries, and fails the domain when Cloudflare refuses it', async () => {
    const down = fakeCloudflare(async () => Promise.reject(new CloudflareUnavailable('no answer')))
    await withSystemScope(db.sql, (tx) =>
      queueSideEffect(tx, { kind: 'custom_domain.recheck', idempotencyKey: 'down', payload: { storeId: domains.mine.storeId, customDomainId: domains.mine.id }, partnerId: domains.mine.partnerId, storeId: domains.mine.storeId }),
    )
    const counts = await relayDue(db.sql, { 'custom_domain.recheck': customDomainRecheckDeliverer(db.sql, dns(true), () => now, down) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    expect(counts).toMatchObject({ delivered: 0, retry: 1 })
    expect(await rowOf(domains.mine)).toEqual({ status: 'waiting', checked_at: null })

    await recheck(domains.mine, dns(true), fakeCloudflare(async () => Promise.reject(new CloudflareRefused('answered 400'))))
    expect((await rowOf(domains.mine))?.status).toBe('failed')
    expect(await purgesFor(domains.mine)).toEqual([])
  })

  it('does not register a domain removed while its DNS was being checked', async () => {
    const ghost = fakeCloudflare(async () => hostname('pending', 'initializing'))
    await recheck(domains.mine, dns(true, () => db.sql`delete from custom_domain where id = ${domains.mine.id}`), ghost)
    expect(ghost.ensured).toEqual([])
  })

  it('takes the host back out of Cloudflare when the domain was removed during its registration', async () => {
    const racing = fakeCloudflare(async () => (await db.sql`delete from custom_domain where id = ${domains.mine.id}`, hostname('pending', 'initializing')))
    await recheck(domains.mine, dns(true), racing)
    expect(racing.removed).toEqual([domains.mine.host])
    expect(await purgesFor(domains.mine)).toEqual([])
  })
})

describe('removing a merchant domain', () => {
  it('takes the host out of Cloudflare after commit and purges the edge lookup, once however often it is asked', async () => {
    const cloudflare = fakeCloudflare(async () => hostname('active', 'active'))
    const d = domains.mine
    // The row change is #471's removeDomain; this is what it queues in the same transaction.
    await db.sql`delete from custom_domain where id = ${d.id}`
    for (let i = 0; i < 2; i++) await withSystemScope(db.sql, (tx) => queueMerchantDomainRemoval(tx, d, now))
    const counts = await relayDue(db.sql, { 'domain.remove': domainRemoveDeliverer(db.sql, cloudflare) }, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
    expect(counts.delivered).toBe(1)
    expect(cloudflare.removed).toEqual([d.host])
    expect((await purgesFor(d)).map((r) => r.payload)).toEqual([{ storeId: d.storeId, host: d.host, reason: 'domain-removed' }])
  })
})

describe('another store’s or partner’s domain', () => {
  it('is never registered or changed by a check that names a different store', async () => {
    const cloudflare = fakeCloudflare(async () => hostname('active', 'active'))
    await recheck(domains.other, dns(true), cloudflare, domains.mine.storeId)
    await recheck(domains.sibling, dns(true), cloudflare, domains.mine.storeId)
    expect(cloudflare.ensured).toEqual([])
    expect(await rowOf(domains.other)).toEqual({ status: 'waiting', checked_at: null })
    expect(await rowOf(domains.sibling)).toEqual({ status: 'waiting', checked_at: null })
  })

  it('is left as it was when one store’s domain goes live', async () => {
    await recheck(domains.mine, dns(true), fakeCloudflare(async () => hostname('active', 'active')))
    expect((await rowOf(domains.mine))?.status).toBe('live')
    for (const d of [domains.sibling, domains.other]) {
      expect(await rowOf(d)).toEqual({ status: 'waiting', checked_at: null })
      expect(await purgesFor(d)).toEqual([])
    }
  })

  it('is never taken out of Cloudflare by a removal of the same host', async () => {
    const cloudflare = fakeCloudflare(async () => hostname('active', 'active'))
    const effect = (host: string) => domainRemoveDeliverer(db.sql, cloudflare).deliver({ payload: { host } } as never, new AbortController().signal)
    await effect(domains.other.host)
    await effect(domains.sibling.host.toUpperCase())
    expect(cloudflare.removed).toEqual([])
  })
})
