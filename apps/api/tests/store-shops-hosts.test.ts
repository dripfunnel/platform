import { readFileSync } from 'node:fs'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PartnerCaller } from '#auth/partnerCaller'
import { withSystemScope } from '#db/scoped/index'
import { hostHeld } from '#db/scoped/partnerDomains'
import { selectStoreForUpdate } from '#db/scoped/stores'
import { CloudflareRefused, CloudflareUnavailable, type CloudflareApi } from '#integrations/cloudflare/api'
import type { DnsLookup } from '#integrations/dns/doh'
import { domainRecheckDeliverer } from '#jobs/queues/deliverers/domainRecheck'
import { domainRemoveDeliverer } from '#jobs/queues/deliverers/domainRemove'
import { storeHostRefusedAction, storeHostSyncDeliverer, storeHostsRegisterDeliverer, storeHostsRemoveDeliverer } from '#jobs/queues/deliverers/storeHost'
import { defaultRelayOptions, relayDue, type Deliverers } from '#jobs/queues/outbox-relay'
import { queueStoreHostSync, queueStoreHostsRegistration, storeHostPageSize, storeHostSyncKind } from '#saas/domains/index'
import { activityLog } from '#saas/activity/index'
import { createPartnerDomainsService } from '#saas/partnerDomains/index'
import { provisionStore } from '#saas/provisioning/index'
import { transitionStore } from '#saas/stores/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #519: each store's `{code}.shops.<partnerdomain>` is its own Cloudflare for SaaS hostname (SAAS §5 step 3, §8).

let db: TestDatabase
const now = new Date('2026-10-11T09:00:00Z')
const ids = { ns: '', bz: '', bf: '', nsShops: '', bzShops: '', bfShops: '' }
const shopsBase = { ns: '', bz: '', bf: '' }

/** Cloudflare for SaaS as a set of hostnames; `mode` makes it refuse or be down. */
const fakeCloudflare = () => {
  const api = {
    mode: 'up' as 'up' | 'down' | 'refuse',
    hosts: new Set<string>(),
    created: [] as string[],
    ensured: [] as string[],
    removed: [] as string[],
    onEnsure: async (): Promise<void> => undefined,
    ensureHostname: async (host: string) => {
      api.ensured.push(host)
      if (api.mode === 'down') throw new CloudflareUnavailable('no answer')
      if (api.mode === 'refuse') throw new CloudflareRefused('answered 422')
      await api.onEnsure()
      if (!api.hosts.has(host)) {
        api.hosts.add(host)
        api.created.push(host)
      }
      return { id: `h-${host}`, hostname: host, status: 'active', ssl: { status: 'active' } }
    },
    removeHostname: async (host: string) => {
      if (api.mode === 'down') throw new CloudflareUnavailable('no answer')
      api.hosts.delete(host)
      api.removed.push(host)
    },
  }
  return api
}

const deliverersFor = (cloudflare: CloudflareApi): Deliverers => ({
  [storeHostSyncKind]: storeHostSyncDeliverer(db.sql, cloudflare),
  'store_hosts.register': storeHostsRegisterDeliverer(db.sql),
  'store_hosts.remove': storeHostsRemoveDeliverer(db.sql),
  'domain.remove': domainRemoveDeliverer(db.sql, cloudflare),
})

let clock = Date.now()
/** Runs the relay until nothing is due, each round a little later so a retried row is not yet due. */
const drain = async (cloudflare: CloudflareApi, later = 0) => {
  const total = { delivered: 0, retry: 0, dead: 0, dropped: 0, skipped: 0 }
  clock = Math.max(clock, Date.now()) + later
  for (let round = 0; round < 40; round++) {
    clock += 1000
    const counts = await relayDue(db.sql, deliverersFor(cloudflare), { ...defaultRelayOptions, now: () => new Date(clock) })
    for (const k of Object.keys(total) as (keyof typeof total)[]) total[k] += counts[k]
    if (Object.values(counts).every((n) => n === 0)) return total
  }
  throw new Error('the relay never drained')
}

/** DNS as the partner set it: every record of the address answers what it expects. */
const dnsPasses: DnsLookup = {
  resolve: async (name, type) => (await db.sql<{ expected: string }[]>`select expected from partner_domain_record where lower(name) = lower(${name}) and record_type = ${type}`).map((r) => r.expected),
}

const goLive = (domainId: string, partnerId: string, at = now) =>
  domainRecheckDeliverer(db.sql, dnsPasses, () => at, null).deliver({ payload: { partnerId, domainId } } as never, new AbortController().signal)

const openCodes = async (partnerId: string) => (await db.sql<{ code: string }[]>`select code from store where partner_id = ${partnerId} and status <> 'closed' order by code`).map((r) => r.code)
const hostsOf = (codes: readonly string[], base: string) => codes.map((c) => `${c}.${base}`).sort()

const provision = (partnerId: string, code: string) =>
  withSystemScope(db.sql, (tx) =>
    provisionStore(tx, { partnerId, owner: { name: 'New Owner', email: `${code}@owner.example`, passwordHash: 'x', phone: '+16145550100' }, store: { name: code, code, country: 'US', currency: 'USD' } }, now),
  )

const close = (storeId: string) =>
  withSystemScope(db.sql, async (tx) => {
    await tx`update store set status = 'cancelled', cancelled_at = ${now} where id = ${storeId}`
    const store = await selectStoreForUpdate(tx, storeId)
    if (!store) throw new Error('no store')
    return transitionStore(tx, store, { to: 'closed' }, now)
  })

const syncRows = (storeId: string) => db.sql`select 1 from outbox where kind = ${storeHostSyncKind} and store_id = ${storeId}`

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  const partnerOf = async (name: string) => (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  ids.ns = await partnerOf('Northstar Commerce')
  ids.bz = await partnerOf('Bazaar Cloud')
  ids.bf = await partnerOf('Blue Fern')
  const shopsOf = async (partnerId: string) => (await db.sql<{ id: string; host: string }[]>`select id, host from partner_domain where partner_id = ${partnerId} and kind = 'shops'`)[0]
  for (const k of ['ns', 'bz', 'bf'] as const) {
    const shops = await shopsOf(ids[k])
    ids[`${k}Shops`] = shops?.id ?? ''
    shopsBase[k] = shops?.host.slice(2) ?? ''
  }
  // More stores than a page, so the fan-outs page.
  await db.sql`
    insert into store (partner_id, name, code, country, pricing_currency, status, storefront_kind, created_at)
    select ${ids.bf}, 'Fern ' || n, 'fern-' || lpad(n::text, 3, '0'), 'US', 'USD', 'active', 'ai', ${now}
    from generate_series(1, ${storeHostPageSize + 5}) n`
}, 180_000)

beforeEach(async () => {
  await db.sql`delete from outbox where kind in ('store_host.sync', 'store_hosts.register', 'store_hosts.remove', 'domain.remove', 'email')`
  await db.sql`update partner_domain set status = 'waiting' where kind = 'shops' and partner_id in (${ids.ns}, ${ids.bz}, ${ids.bf})`
})

afterAll(async () => {
  await db?.drop()
})

describe('registering each store’s shops host', () => {
  it('registers nothing while the shops address is not live, then every store once when it goes live, a new one included', async () => {
    const cloudflare = fakeCloudflare()
    const made = await provision(ids.ns, 'cedar-519')
    if (!made.ok) throw new Error(made.reason)
    expect(await syncRows(made.storeId)).toHaveLength(1)
    await drain(cloudflare)
    expect(cloudflare.ensured).toEqual([])

    await goLive(ids.nsShops, ids.ns)
    await drain(cloudflare)
    expect([...cloudflare.created].sort()).toEqual(hostsOf(await openCodes(ids.ns), shopsBase.ns))
    expect(cloudflare.created).toContain(`cedar-519.${shopsBase.ns}`)
    expect(cloudflare.ensured.filter((h, i) => cloudflare.ensured.indexOf(h) !== i)).toEqual([])
  })

  it('registers a store made after the address is live straight away, and never one of another partner', async () => {
    await db.sql`update partner_domain set status = 'live' where id = ${ids.nsShops}`
    const cloudflare = fakeCloudflare()
    const made = await provision(ids.ns, 'birch-519')
    if (!made.ok) throw new Error(made.reason)
    await drain(cloudflare)
    expect(cloudflare.created).toEqual([`birch-519.${shopsBase.ns}`])

    // A sync naming another partner, or a page naming another partner's address, registers nothing.
    const bzStore = (await db.sql<{ id: string }[]>`select id from store where partner_id = ${ids.bz} limit 1`)[0]?.id ?? ''
    await withSystemScope(db.sql, async (tx) => {
      await tx`insert into outbox (kind, idempotency_key, payload, partner_id, store_id) values (${storeHostSyncKind}, 'cross', ${JSON.stringify({ partnerId: ids.ns, storeId: bzStore })}::text::jsonb, ${ids.ns}, ${bzStore})`
      await queueStoreHostsRegistration(tx, { partnerId: ids.bz, domainId: ids.nsShops, round: 'cross' })
    })
    await drain(cloudflare)
    expect(cloudflare.created).toEqual([`birch-519.${shopsBase.ns}`])
    expect(cloudflare.ensured.every((h) => h.endsWith(`.${shopsBase.ns}`))).toBe(true)
  })

  it('pages through every store once, even when a page is delivered twice, and reaches a store made while the address was broken', async () => {
    const cloudflare = fakeCloudflare()
    await goLive(ids.bfShops, ids.bf)
    const page = { payload: { partnerId: ids.bf, domainId: ids.bfShops, round: now.toISOString(), after: null } } as never
    await storeHostsRegisterDeliverer(db.sql).deliver(page, new AbortController().signal)
    await storeHostsRegisterDeliverer(db.sql).deliver(page, new AbortController().signal)
    await drain(cloudflare)
    expect(cloudflare.ensured).toHaveLength((await openCodes(ids.bf)).length)

    await db.sql`update partner_domain set status = 'broken' where id = ${ids.bfShops}`
    const [late] = await db.sql<{ id: string }[]>`
      insert into store (partner_id, name, code, country, pricing_currency, status, storefront_kind, created_at)
      values (${ids.bf}, 'Fern late', 'fern-late', 'US', 'USD', 'active', 'ai', ${now}) returning id`
    await withSystemScope(db.sql, (tx) => queueStoreHostSync(tx, { partnerId: ids.bf, storeId: late?.id ?? '' }, 'provisioned'))
    await drain(cloudflare)
    expect(cloudflare.ensured).not.toContain(`fern-late.${shopsBase.bf}`)
    await goLive(ids.bfShops, ids.bf, new Date(now.getTime() + 60_000))
    await drain(cloudflare)
    const codes = await openCodes(ids.bf)
    expect(codes.length).toBeGreaterThan(storeHostPageSize)
    expect([...cloudflare.ensured].sort()).toEqual(hostsOf(codes, shopsBase.bf))
    expect(await db.sql`select 1 from outbox where kind = 'store_hosts.register' and partner_id = ${ids.bf}`).toHaveLength(4)
  })

  it('retries while Cloudflare is down, and records a refusal in the activity log and the technical logs', async () => {
    await db.sql`update partner_domain set status = 'live' where id = ${ids.nsShops}`
    const cloudflare = fakeCloudflare()
    cloudflare.mode = 'down'
    const made = await provision(ids.ns, 'aspen-519')
    if (!made.ok) throw new Error(made.reason)
    expect((await drain(cloudflare)).retry).toBe(1)
    cloudflare.mode = 'up'
    await drain(cloudflare, 24 * 60 * 60 * 1000)
    expect(cloudflare.created).toEqual([`aspen-519.${shopsBase.ns}`])

    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    cloudflare.mode = 'refuse'
    const refused = await provision(ids.ns, 'rowan-519')
    if (!refused.ok) throw new Error(refused.reason)
    const counts = await drain(cloudflare)
    expect(counts).toMatchObject({ delivered: 1, retry: 0 })
    const [entry] = await db.sql<{ result: string; partner_id: string; visibility: string; target_label: string }[]>`
      select result, partner_id, visibility, target_label from activity_log where action = ${storeHostRefusedAction} and store_id = ${refused.storeId}`
    expect(entry).toEqual({ result: 'failed', partner_id: ids.ns, visibility: 'partner', target_label: `rowan-519.${shopsBase.ns}` })
    const lines = logged.mock.calls.map((c) => String(c[0])).filter((l) => l.includes('store_host.refused'))
    expect(lines.map((l) => JSON.parse(l) as unknown)).toEqual([{ event: 'store_host.refused', api: 'system', partnerId: ids.ns, storeId: refused.storeId, code: 'cloudflare_refused' }])
    logged.mockRestore()
  })
})

describe('taking store hosts out of Cloudflare', () => {
  it('takes a closed store’s host out, and a store closed during its registration is not left registered', async () => {
    await db.sql`update partner_domain set status = 'live' where id = ${ids.nsShops}`
    const cloudflare = fakeCloudflare()
    const made = await provision(ids.ns, 'maple-519')
    if (!made.ok) throw new Error(made.reason)
    await drain(cloudflare)
    const host = `maple-519.${shopsBase.ns}`
    expect(cloudflare.hosts.has(host)).toBe(true)
    expect((await close(made.storeId)).ok).toBe(true)
    await drain(cloudflare)
    expect(cloudflare.hosts.has(host)).toBe(false)

    const racing = await provision(ids.ns, 'hazel-519')
    if (!racing.ok) throw new Error(racing.reason)
    cloudflare.onEnsure = async () => void (await close(racing.storeId))
    await drain(cloudflare)
    expect(cloudflare.hosts.has(`hazel-519.${shopsBase.ns}`)).toBe(false)
  })

  it('takes every store’s host out when the partner removes its shops address, and only that partner’s', async () => {
    await db.sql`update partner_domain set status = 'live' where id in (${ids.bfShops}, ${ids.nsShops})`
    const cloudflare = fakeCloudflare()
    for (const partnerId of [ids.bf, ids.ns]) {
      const codes = await openCodes(partnerId)
      const base = partnerId === ids.bf ? shopsBase.bf : shopsBase.ns
      for (const h of hostsOf(codes, base)) cloudflare.hosts.add(h)
    }
    const nsHosts = hostsOf(await openCodes(ids.ns), shopsBase.ns)
    const owner: PartnerCaller = { role: 'partner-owner', user: { id: crypto.randomUUID(), name: 'Fern Owner', email: 'owner@bluefern.example' }, staff: null, partner: { id: ids.bf, name: 'Blue Fern', product: 'Blue Fern', host: null, state: 'live' } }
    const service = createPartnerDomainsService({ sql: db.sql, caller: owner, facts: { requestId: 'r', ip: null, userAgent: null }, activity: activityLog, edgeZone: 'edge.example', now: () => now })
    expect(await service.removePartnerDomain('shops')).toEqual({ ok: true })
    await drain(cloudflare)
    expect([...cloudflare.hosts].sort()).toEqual(nsHosts)
    expect(cloudflare.removed.filter((h) => h.endsWith(`.${shopsBase.bf}`))).toHaveLength((await openCodes(ids.bf)).length)
    const held = (host: string) => withSystemScope(db.sql, (tx) => hostHeld(tx, host))
    expect(await held(nsHosts[0] ?? '')).toBe(true)
    expect(await held(`maple-519.${shopsBase.ns}`)).toBe(false)
    expect(await held(`fern-001.${shopsBase.bf}`)).toBe(false)
  })
})

describe('the backfill (migration 0220)', () => {
  const backfill = readFileSync(new URL('../migrations/0220_store_shops_hosts_backfill.sql', import.meta.url), 'utf8')

  it('registers every open store under a live shops address once, and running it again, or the fan-out after it, adds nothing', async () => {
    await db.sql`update partner_domain set status = 'live' where id = ${ids.nsShops}`
    const cloudflare = fakeCloudflare()
    await db.sql.unsafe(backfill)
    await drain(cloudflare)
    expect(cloudflare.ensured.filter((h) => h.endsWith(`.${shopsBase.ns}`)).sort()).toEqual(hostsOf(await openCodes(ids.ns), shopsBase.ns))

    const queued = await db.sql`select 1 from outbox where kind = ${storeHostSyncKind}`
    await db.sql.unsafe(backfill)
    await withSystemScope(db.sql, (tx) => queueStoreHostsRegistration(tx, { partnerId: ids.ns, domainId: ids.nsShops, round: 'after-backfill' }))
    await drain(cloudflare)
    expect(await db.sql`select 1 from outbox where kind = ${storeHostSyncKind}`).toHaveLength(queued.length)
    expect(cloudflare.ensured).toHaveLength(queued.length)
  })
})
