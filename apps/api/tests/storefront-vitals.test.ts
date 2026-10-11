import type postgres from 'postgres'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ShopContext } from '#apis/shop/access'
import { handleVitals } from '#apis/shop/vitals'
import { resolveShopper } from '#auth/shopCaller'
import { withSystemScope } from '#db/scoped/index'
import { recordVitals } from '#db/scoped/vitals'
import { activityLog } from '#saas/activity/index'
import { readVitalsRegressions, startPublish } from '#saas/storefronts/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #484 (INF 5) part 3: real-user Core Web Vitals after consent, kept per day with no visitor id, and the regression
// rule that rolls a severe regression back (storefront ARCHITECTURE §9).

let db: TestDatabase
let t: Tenants
const hostA1 = 'store-a1.shops.acme.example'
const hostB1 = 'store-b1.shops.beta.example'
const commit = (n: number) => n.toString(16).padStart(40, '0')
const day = (offset: number, from = new Date('2026-10-11T12:00:00Z')) => new Date(from.getTime() + offset * 86_400_000)

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  await db.sql`update store set status = 'active', pricing_currency = 'INR' where id in (${t.storeA1}, ${t.storeB1})`
  await db.sql`update partner set state = 'live' where id in (${t.partnerA}, ${t.partnerB})`
  await db.sql`insert into partner_domain (partner_id, kind, host, status, record_type, expected) values (${t.partnerA}, 'shops', '*.shops.acme.example', 'live', 'CNAME', 'x'), (${t.partnerB}, 'shops', '*.shops.beta.example', 'live', 'CNAME', 'y')`
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const beacon = async (host: string, body: string, now = new Date()) => {
  const found = await resolveShopper(db.sql, new Request(`https://${host}/shop-api/vitals`), host)
  if (found.kind !== 'found') throw new Error('no store')
  const ctx: ShopContext = { sql: db.sql, shopper: found.shopper, origin: `https://${host}`, activity: activityLog, facts: { requestId: 'r', ip: '203.0.113.4', userAgent: null }, allowNewCart: async () => false, now: () => now }
  return (await handleVitals(new Request(`https://${host}/shop-api/vitals`, { method: 'POST', body }), ctx)).status
}
const rows = (storeId: string) => db.sql<{ page_kind: string; device: string; samples: number }[]>`select page_kind, device, samples from storefront_vitals_day where store_id = ${storeId} order by day, page_kind`

describe('the vitals intake', () => {
  it('keeps one page view’s measures in its day’s histograms, for the host’s store, with no visitor id', async () => {
    expect(await beacon(hostA1, JSON.stringify({ page: 'product', device: 'phone', lcp: 1800, inp: 120, cls: 0.02 }))).toBe(204)
    expect(await beacon(hostA1, JSON.stringify({ page: 'product', device: 'phone', lcp: 2600, inp: 80, cls: 0 }))).toBe(204)
    expect(await rows(t.storeA1)).toEqual([{ page_kind: 'product', device: 'phone', samples: 2 }])
    const columns = await db.sql<{ column_name: string }[]>`select column_name from information_schema.columns where table_name = 'storefront_vitals_day' order by ordinal_position`
    expect(columns.map((c) => c.column_name)).toEqual(['store_id', 'day', 'page_kind', 'device', 'samples', 'lcp_hist', 'inp_hist', 'cls_hist'])
  })

  it('keeps nothing for a preview host, a store that isn’t selling, or with no database, and counts no INP for a visit with no interaction', async () => {
    const found = await resolveShopper(db.sql, new Request(`https://${hostA1}/shop-api/vitals`), hostA1)
    if (found.kind !== 'found') throw new Error('no store')
    const body = JSON.stringify({ page: 'cart', device: 'desktop', lcp: 900, inp: 40, cls: 0 })
    const send = (ctx: Partial<ShopContext>) =>
      handleVitals(new Request(`https://${hostA1}/shop-api/vitals`, { method: 'POST', body }), { sql: db.sql, shopper: found.shopper, origin: '', activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, allowNewCart: async () => false, now: () => new Date(), ...ctx })
    expect((await send({ shopper: { ...found.shopper, preview: true } })).status).toBe(204)
    expect((await send({ shopper: { ...found.shopper, available: false } })).status).toBe(204)
    expect((await send({ sql: null })).status).toBe(204)
    expect((await rows(t.storeA1)).filter((r) => r.page_kind === 'cart')).toEqual([])
    expect(await beacon(hostA1, JSON.stringify({ page: 'cart', device: 'desktop', lcp: 900, inp: null, cls: 0 }))).toBe(204)
    const [cart] = await db.sql<{ inp_hist: number[]; samples: number }[]>`select array_to_json(inp_hist) as inp_hist, samples from storefront_vitals_day where store_id = ${t.storeA1} and page_kind = 'cart'`
    expect([cart?.samples, cart?.inp_hist.reduce((a, b) => a + b, 0)]).toEqual([1, 0])
    await db.sql`delete from storefront_vitals_day where store_id = ${t.storeA1} and page_kind = 'cart'`
  })

  it('refuses a body over 1 KB before reading it, by its declared length or as it streams', async () => {
    const found = await resolveShopper(db.sql, new Request(`https://${hostA1}/shop-api/vitals`), hostA1)
    if (found.kind !== 'found') throw new Error('no store')
    const ctx: ShopContext = { sql: db.sql, shopper: found.shopper, origin: '', activity: activityLog, facts: { requestId: 'r', ip: null, userAgent: null }, allowNewCart: async () => false, now: () => new Date() }
    const declared = new Request(`https://${hostA1}/shop-api/vitals`, { method: 'POST', headers: { 'content-length': '5000000' }, body: 'x' })
    expect((await handleVitals(declared, ctx)).status).toBe(413)
    let pulled = 0
    const endless = new ReadableStream<Uint8Array>({ pull: (c) => void (pulled += 1, c.enqueue(new Uint8Array(512))) })
    const streamed = new Request(`https://${hostA1}/shop-api/vitals`, { method: 'POST', body: endless, duplex: 'half' } as RequestInit)
    expect((await handleVitals(streamed, ctx)).status).toBe(413)
    expect(pulled).toBeLessThan(10)
    // Bytes, not characters: 400 three-byte characters are over the limit.
    expect(await beacon(hostA1, JSON.stringify({ page: 'home', device: 'desktop', lcp: 900, inp: 40, cls: 0, x: '€'.repeat(400) }))).toBe(413)
  })

  it('refuses anything else in the body: an id, an address, a page kind it doesn’t know, a body too large', async () => {
    const ok = { page: 'home', device: 'desktop', lcp: 900, inp: 40, cls: 0 }
    for (const body of [{ ...ok, visitor: 'v-1' }, { ...ok, url: 'https://x/' }, { ...ok, page: 'secret' }, { ...ok, lcp: -1 }]) expect(await beacon(hostA1, JSON.stringify(body))).toBe(400)
    expect(await beacon(hostA1, 'not json')).toBe(400)
    expect(await beacon(hostA1, JSON.stringify({ ...ok, pad: 'x'.repeat(2000) }))).toBe(413)
    expect(await rows(t.storeA1)).toEqual([{ page_kind: 'product', device: 'phone', samples: 2 }])
  })

  it('never shows store A’s vitals to store B, a supplier, a partner or staff', async () => {
    await beacon(hostB1, JSON.stringify({ page: 'home', device: 'desktop', lcp: 900, inp: 40, cls: 0 }))
    const as = (role: string, scope: string, storeId: string, sellerId = '') =>
      db.sql.begin(async (tx: postgres.TransactionSql) => {
        await tx.unsafe(`set local role ${role}`)
        await tx`select set_config('app.scope', ${scope}, true)`
        await tx`select set_config('app.partner_id', ${t.partnerA}, true)`
        await tx`select set_config('app.store_id', ${storeId}, true)`
        await tx`select set_config('app.seller_id', ${sellerId}, true)`
        return (await tx<{ store_id: string }[]>`select store_id from storefront_vitals_day`).map((r) => r.store_id)
      })
    expect(await as('app_request', 'store', t.storeA1)).toEqual([t.storeA1])
    expect(await as('app_request', 'store', t.storeB1)).toEqual([t.storeB1])
    expect(await as('app_request', 'store', t.storeA1, t.sellerA1First)).toEqual([])
    await expect(as('app_partner', 'partner', t.storeA1)).rejects.toThrow(/permission denied/)
    await expect(as('app_platform', 'platform', t.storeA1)).rejects.toThrow(/permission denied/)
  })
})

describe('the regression rule', () => {
  /** `n` page views of the same measures on `at`'s day. */
  const fill = async (storeId: string, at: Date, n: number, m: { lcp: number; inp: number; cls: number }) => {
    await withSystemScope(db.sql, async (tx) => {
      for (let i = 0; i < n; i++) await recordVitals(tx, { storeId, day: at.toISOString().slice(0, 10), pageKind: 'home', device: 'phone', lcpMs: m.lcp, inpMs: m.inp, clsThousandths: m.cls })
    })
  }
  const liveRun = async (storeId: string, n: number, switchedAt: Date, previous: string | null) => {
    const started = await withSystemScope(db.sql, (tx) =>
      startPublish(tx, { storeId, kind: 'design', commit: commit(n), template: 'linen', coreVersion: '1.0.0', usesAllowance: false, startedBy: { kind: 'system', id: null }, at: switchedAt }),
    )
    const id = started.ok ? started.runId : ''
    await db.sql`update publish_run set state = 'live', switched_at = ${switchedAt}, finished_at = ${switchedAt}, previous_build_id = ${previous} where id = ${id}`
    await db.sql`update storefront set live_build_id = ${id} where store_id = ${storeId}`
    await db.sql`update design_version set state = 'kept' where store_id = ${storeId}`
    await db.sql`insert into design_version (store_id, number, commit, template, core_version, build_id, published_at, state) select ${storeId}, coalesce(max(number), 0) + 1, ${commit(n)}, 'linen', '1.0.0', ${id}, ${switchedAt}, 'live' from design_version where store_id = ${storeId}`
    return id
  }
  const run = async (id: string) => (await db.sql<{ state: string; error: string | null; vitals: { verdict: string; rolledBack: boolean } | null }[]>`select state, error, vitals from publish_run where id = ${id}`)[0]
  const live = async (storeId: string) => (await db.sql<{ live_build_id: string }[]>`select live_build_id from storefront where store_id = ${storeId}`)[0]?.live_build_id

  it('rolls a build whose LCP doubled back to the one before, once its first whole day is in', async () => {
    const switched = day(0)
    const before = await liveRun(t.storeA2, 1, day(-10), null)
    const after = await liveRun(t.storeA2, 2, switched, before)
    for (const d of [-3, -2]) await fill(t.storeA2, day(d), 40, { lcp: 1500, inp: 100, cls: 20 })
    await fill(t.storeA2, day(1), 60, { lcp: 3800, inp: 110, cls: 20 })
    // Not before its first whole day is over.
    expect(await readVitalsRegressions(db.sql, day(1))).toBe(0)
    expect(await readVitalsRegressions(db.sql, day(2))).toBe(1)
    expect(await run(after)).toMatchObject({ state: 'rolled_back', error: 'vitals_regressed', vitals: { verdict: 'severe', rolledBack: true } })
    expect(await live(t.storeA2)).toBe(before)
    const [entry] = await db.sql<{ reason: string }[]>`select reason from activity_log where store_id = ${t.storeA2} and action = 'storefront.rolled_back'`
    expect(entry?.reason).toBe('vitals_regressed')
    // Read once: a second pass changes nothing.
    expect(await readVitalsRegressions(db.sql, day(3))).toBe(0)
  })

  it('flags a smaller regression without rolling back, and says nothing with too few samples', async () => {
    await db.sql`delete from storefront_vitals_day where store_id = ${t.storeA2}`
    const prior = await live(t.storeA2)
    const flagged = await liveRun(t.storeA2, 3, day(10), prior ?? null)
    await fill(t.storeA2, day(8), 60, { lcp: 1500, inp: 100, cls: 20 })
    await fill(t.storeA2, day(11), 60, { lcp: 2000, inp: 100, cls: 20 })
    expect(await readVitalsRegressions(db.sql, day(12))).toBe(1)
    expect(await run(flagged)).toMatchObject({ state: 'live', vitals: { verdict: 'regressed', rolledBack: false } })
    const quiet = await liveRun(t.storeA2, 4, day(20), flagged)
    await fill(t.storeA2, day(18), 10, { lcp: 1500, inp: 100, cls: 20 })
    await fill(t.storeA2, day(21), 10, { lcp: 9000, inp: 900, cls: 900 })
    expect(await readVitalsRegressions(db.sql, day(22))).toBe(1)
    expect(await run(quiet)).toMatchObject({ state: 'live', vitals: { verdict: 'ok', rolledBack: false } })
  })
})
