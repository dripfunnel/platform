import { graphql, type GraphQLSchema } from 'graphql'
import postgres from 'postgres'
import { deliverySchema, type DeliveryContext } from '#apis/delivery/schema'
import { secretBox } from '#auth/secretBox'
import { createOwnDelivery, offerKind, sweepDispatch } from '#engine/modules/ownDelivery/index'
import { deliveryOfferDeliverer } from '#jobs/queues/deliverers/deliveryOffer'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createTestDatabase } from '../../tests/support/database'
import { seedTenants } from '../../tests/support/fixtures'

// The load check of DELIVERY.md §10 (#873): riders online in one store reporting positions while orders are offered to all of
// them, through the Delivery API's own schema against a database of its own on the local Postgres. Not part of any gate.
//   pnpm --filter ./apps/api load:delivery [--riders 200] [--orders-per-minute 20] [--minutes 10] [--interval-seconds 15]

const arg = (name: string, fallback: number): number => {
  const at = process.argv.indexOf(`--${name}`)
  const value = at === -1 ? fallback : Number(process.argv[at + 1])
  if (!Number.isFinite(value) || value <= 0) throw new Error(`--${name} must be a positive number`)
  return value
}
const riderCount = arg('riders', 200)
const ordersPerMinute = arg('orders-per-minute', 20)
const minutes = arg('minutes', 10)
const reportEveryMs = arg('interval-seconds', 15) * 1000
const holdMs = 45_000
const acceptShare = 0.2
const pin = { latitude: 26.9124, longitude: 75.7873 }

const url = new URL(process.env.DATABASE_URL ?? 'postgres://dripfunnel_dev:dripfunnel_dev@localhost:5432/dripfunnel')
if (!['localhost', '127.0.0.1', '::1'].includes(url.hostname)) throw new Error(`Refusing to run against ${url.hostname}: the load check uses the local Postgres only (AGENTS.md rule 3).`)

const samples = new Map<string, number[]>()
const record = (name: string, ms: number) => samples.set(name, [...(samples.get(name) ?? []), ms])
const percentile = (values: number[], p: number) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * p))] ?? 0
const log = console.log
console.log = (line: unknown) => { if (typeof line !== 'string' || !line.startsWith('{"event":')) log(line) }
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

const main = async () => {
  const db = await createTestDatabase()
  const sql = postgres(db.url, { max: 20, fetch_types: false })
  const secrets = await secretBox(btoa('k'.repeat(32)))
  let stop = false
  try {
    const tenants = await seedTenants(db.sql)
    const [w] = await db.sql<{ id: string }[]>`select id from warehouse where store_id = ${tenants.storeA1} and seller_id is null limit 1`
    const warehouse = w?.id ?? ''
    await db.sql`update warehouse set latitude = ${pin.latitude}, longitude = ${pin.longitude} where id = ${warehouse}`
    await db.sql`insert into store_shipping (store_id, currency, own_delivery_enabled, dispatch_when, offer_minutes) values (${tenants.storeA1}, 'INR', true, 'placed', 2)
      on conflict (store_id) do update set own_delivery_enabled = true, dispatch_when = 'placed', offer_minutes = 2`
    const [plan] = await db.sql<{ id: string }[]>`insert into plan (partner_id, name, status) values (${tenants.partnerA}, 'Load', 'live') returning id`
    await db.sql`insert into plan_entitlement (plan_id, partner_id, version, key, enabled) values (${plan?.id ?? ''}, ${tenants.partnerA}, 1, 'own_delivery', true)`
    await db.sql`update store set plan_id = ${plan?.id ?? ''}, pricing_currency = 'INR' where id = ${tenants.storeA1}`
    await db.sql`insert into store_subscription (store_id, partner_id, plan_id, plan_version, status, interval, currency, amount, period_start, period_end)
      values (${tenants.storeA1}, ${tenants.partnerA}, ${plan?.id ?? ''}, 1, 'active', 'month', 'INR', 0, now(), now() + interval '30 days')`
    const riders = (await db.sql<{ id: string }[]>`insert into rider (store_id, name, phone, status) select ${tenants.storeA1}, 'Rider ' || n, '+9199' || lpad(n::text, 8, '0'), 'active' from generate_series(1, ${riderCount}) n returning id`).map((r) => r.id)

    const asRider = async (riderId: string, source: string, variables: Record<string, unknown> = {}) => {
      const rider = { partnerId: tenants.partnerA, storeId: tenants.storeA1, sellerScope: { kind: 'all' }, subscription: 'active', caller: { kind: 'rider', riderId } } as const
      const contextValue: DeliveryContext = {
        sql, caller: { storeId: tenants.storeA1, partnerId: tenants.partnerA, available: true, rider, token: null }, activity: activityLog,
        facts: { requestId: 'load', ip: null, userAgent: null }, defer: () => undefined, secrets, now: () => new Date(),
      }
      return graphql({ schema: deliverySchema as GraphQLSchema, source, contextValue, variableValues: variables })
    }
    const timed = async (name: string, riderId: string, source: string, variables?: Record<string, unknown>) => {
      const started = performance.now()
      const result = await asRider(riderId, source, variables)
      const code = result.errors?.[0]?.extensions['code']
      record(code === 'TAKEN' ? `${name} (lost race)` : result.errors ? `${name} (error ${String(code)})` : name, performance.now() - started)
      return result
    }
    const report = (riderId: string, i: number) =>
      timed('reportPosition', riderId, 'mutation P($lat: Float!, $lng: Float!, $at: String!) { reportPosition(lat: $lat, lng: $lng, accuracy: 5, at: $at) }',
        { lat: pin.latitude + (i % 10) * 0.0001, lng: pin.longitude + (i % 7) * 0.0001, at: new Date().toISOString() })

    for (const [i, id] of riders.entries()) {
      await asRider(id, 'mutation { setOnline(online: true) }')
      await report(id, i)
    }

    const reacting = new Set<Promise<unknown>>()
    const react = (riderId: string) => {
      const work = sleep(1000 + Math.random() * 4000).then(async () => {
        const page = await timed('offers', riderId, '{ offers { nodes { id } } }')
        const offer = (page.data?.['offers'] as { nodes: { id: string }[] } | null | undefined)?.nodes[0]
        if (offer && Math.random() < acceptShare) await timed('acceptOffer', riderId, 'mutation A($id: ID!) { acceptOffer(id: $id) }', { id: offer.id })
      })
      reacting.add(work)
      void work.finally(() => reacting.delete(work))
    }
    const deliverers = {
      [offerKind]: deliveryOfferDeliverer(sql, activityLog, () => new Date()),
      push: { deliver: async (effect: { payload: unknown }) => {
        const payload = effect.payload as { message: string; subject: { id: string } }
        if (payload.message === 'rider.offer') react(payload.subject.id)
      } },
    }

    const slow = new Map<string, { samples: number; maxMs: number }>()
    let active = 0
    let polls = 0
    const watcher = (async () => {
      while (!stop) {
        const rows = await db.sql<{ ms: number; q: string }[]>`select extract(epoch from now() - query_start) * 1000 as ms, left(regexp_replace(query, '[0-9a-f]{8}-[0-9a-f-]{27}|\\d+', '?', 'g'), 140) as q
          from pg_stat_activity where datname = current_database() and state = 'active' and pid <> pg_backend_pid()`
        polls += 1
        active += rows.length
        for (const { ms, q } of rows) if (ms > 100) slow.set(q, { samples: (slow.get(q)?.samples ?? 0) + 1, maxMs: Math.max(slow.get(q)?.maxMs ?? 0, ms) })
        await sleep(250)
      }
    })()

    const deadline = Date.now() + minutes * 60_000
    const loops = [
      ...riders.map(async (id, i) => {
        await sleep(reportEveryMs * (0.7 + Math.random() * 0.3))
        while (Date.now() < deadline) { await report(id, i); await sleep(reportEveryMs) }
      }),
      (async () => {
        while (Date.now() < deadline) {
          const started = Date.now()
          const [o] = await db.sql<{ id: string }[]>`insert into "order" (store_id, state, number, currency, payment_method, payment_state, shipping_option, delivery_warehouse_id, total_amount, placed_at, shipping_address)
            values (${tenants.storeA1}, 'placed', ${crypto.randomUUID()}, 'INR', 'cod', 'pending', 'own_delivery', ${warehouse}, 10000, now(), '{"line1":"x","city":"Jaipur","postalCode":"302017","name":"Load"}') returning id`
          await db.sql`insert into payment (store_id, order_id, provider, kind, amount, currency, mode) values (${tenants.storeA1}, ${o?.id ?? ''}, 'cod', 'cod', 10000, 'INR', 'live')`
          await sql.begin((tx) => createOwnDelivery(tx as never, activityLog, tenants.storeA1, o?.id ?? '', new Date()))
          await sleep(Math.max(0, 60_000 / ordersPerMinute - (Date.now() - started)))
        }
      })(),
      (async () => {
        while (Date.now() < deadline) {
          const started = performance.now()
          await relayDue(sql, deliverers, { ...defaultRelayOptions, now: () => new Date(Date.now() + 1000) })
          record('offer job + pushes (one relay pass)', performance.now() - started)
          await sleep(500)
        }
      })(),
      (async () => {
        while (Date.now() < deadline) {
          await sleep(60_000)
          const started = performance.now()
          await sweepDispatch(sql, activityLog, new Date())
          record('minute sweep', performance.now() - started)
        }
      })(),
      (async () => {
        while (Date.now() < deadline) {
          await sleep(holdMs)
          await db.sql`update delivery set state = 'cancelled' where state = 'assigned' and assigned_at < now() - make_interval(secs => ${holdMs / 1000})`
        }
      })(),
    ]
    await Promise.all(loops)
    await Promise.all(reacting)
    stop = true
    await watcher

    const [{ offers, deliveries } = { offers: 0, deliveries: 0 }] = await db.sql<{ offers: number; deliveries: number }[]>`select (select count(*)::int from delivery_offer) as offers, (select count(*)::int from delivery) as deliveries`
    const scans = await db.sql<{ relname: string; seq_scan: string; idx_scan: string; n_live_tup: string }[]>`
      select relname, seq_scan::text, coalesce(idx_scan, 0)::text as idx_scan, n_live_tup::text from pg_stat_user_tables where relname in ('delivery', 'delivery_offer', 'rider', 'rider_position', 'outbox') order by relname`
    console.log(`\n${riderCount} riders, ${ordersPerMinute} orders/minute, ${minutes} min, a position every ${reportEveryMs / 1000} s: ${deliveries} deliveries, ${offers} offers\n`)
    console.log('| operation | count | p50 ms | p95 ms | max ms |\n|---|---|---|---|---|')
    for (const [name, values] of [...samples].sort(([a], [b]) => a.localeCompare(b))) {
      console.log(`| ${name} | ${values.length} | ${percentile(values, 0.5).toFixed(1)} | ${percentile(values, 0.95).toFixed(1)} | ${Math.max(...values).toFixed(1)} |`)
    }
    console.log(`\nDatabase: ${(active / Math.max(polls, 1)).toFixed(2)} statements running on average (pg_stat_activity, sampled every 250 ms); this is a proxy for CPU, which a local Postgres does not report.`)
    console.log('\nStatements seen running over 100 ms:')
    for (const [q, s] of [...slow].sort(([, a], [, b]) => b.maxMs - a.maxMs).slice(0, 10)) console.log(`- ${s.maxMs.toFixed(0)} ms max, ${s.samples} samples: ${q.replaceAll('\n', ' ')}`)
    if (slow.size === 0) console.log('- none')
    console.log('\nTable scans:\n| table | rows | seq scans | index scans |\n|---|---|---|---|')
    for (const s of scans) console.log(`| ${s.relname} | ${s.n_live_tup} | ${s.seq_scan} | ${s.idx_scan} |`)
  } finally {
    stop = true
    await sql.end()
    await db.drop()
  }
}

main().catch((error: unknown) => {
  console.error(error)
  process.exit(1)
})
