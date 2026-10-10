import { createHmac } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { withScope } from '#db/scoped/index'
import { storeEventKind } from '#db/scoped/storeEvents'
import { webhookDeliveryDeliverer, webhookEventDeliverer } from '#jobs/queues/deliverers/webhooks'
import { defaultRelayOptions, relayDue, type Deliverers } from '#jobs/queues/outbox-relay'
import { webhookDeliveryKind } from '#saas/webhooks/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'
import { fakeEndpoint, fakeLookup, seedStoreWorld, type StoreWorld, type Who } from './support/storeWorld'

// Card #330 (SAPI 20), part 2: webhooks from the outbox (PLATFORM-PROMPT §5.5, ACCESS §5.6): signed, checked against
// private addresses when saved, on every delivery and on replay, retried with backoff to a limit, turned off after
// 3 days of failures with the Owners told, and sent again within 7 days.

let db: TestDatabase
let t: Tenants
let w: StoreWorld
let secrets: SecretBox
let now = new Date(Date.now() + 1000)
let answer = 200
const dns = new Map<string, string[]>([
  ['A hooks.shop.example', ['93.184.216.34']],
  ['A other.shop.example', ['93.184.216.35']],
  ['A inside.shop.example', ['10.0.0.5']],
  ['A meta.shop.example', ['169.254.169.254']],
  ['AAAA local.shop.example', ['::1']],
])
const endpoint = fakeEndpoint(() => answer)
const deliverers = (): Deliverers => ({
  [storeEventKind]: webhookEventDeliverer(db.sql, () => now),
  [webhookDeliveryKind]: webhookDeliveryDeliverer(db.sql, { lookup: fakeLookup(dns), secrets, fetchImpl: endpoint.fetchImpl, now: () => now }),
})
// Rows take the database's clock when queued, so the test's clock never runs behind it.
const relay = () => {
  now = new Date(Math.max(now.getTime(), Date.now() + 1000))
  return relayDue(db.sql, deliverers(), { ...defaultRelayOptions, now: () => now })
}

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  secrets = await secretBox(btoa('k'.repeat(32)))
  w = await seedStoreWorld(db.sql, t, { now: () => now, secrets, lookup: fakeLookup(dns) })
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const save = async (who: Who, url: string, events: string[], id?: string) => {
  const r = await w.gql(who, 'mutation S($id: ID, $url: String!, $events: [String!]!) { saveWebhook(id: $id, url: $url, events: $events) { id secret } }', { id, url, events })
  return { saved: r.data?.['saveWebhook'] as { id: string; secret: string | null } | undefined, code: r.code }
}
interface Endpoint {
  id: string
  url: string
  events: string[]
  status: string
  failingSince: string | null
}
const endpoints = async (who: Who) => {
  const r = await w.gql(who, '{ webhooks { nodes { id url events status failingSince } } }')
  return { list: (r.data?.['webhooks'] as { nodes: Endpoint[] } | null)?.nodes, code: r.code }
}
interface Delivery {
  id: string
  event: string
  eventId: string
  status: string
  attempts: number
  responseCode: number | null
  error: string | null
  replayOf: string | null
}
const deliveries = async (who: Who, endpointId: string) => {
  const r = await w.gql(who, 'query D($id: ID!) { webhookDeliveries(endpointId: $id) { nodes { id event eventId status attempts responseCode error replayOf } } }', { id: endpointId })
  return { list: (r.data?.['webhookDeliveries'] as { nodes: Delivery[] } | null)?.nodes, code: r.code }
}
const replay = async (who: Who, id: string) => {
  const r = await w.gql(who, 'mutation R($id: ID!) { replayDelivery(id: $id) }', { id })
  return { id: r.data?.['replayDelivery'] as string | undefined, code: r.code }
}
const product = async (who: Who, name: string) => {
  const r = await w.gql(who, 'mutation S($input: ProductInput!) { saveProduct(input: $input) { id } }', { input: { name, options: [], versions: [{ choices: [], prices: [{ currency: 'INR', amount: '100' }] }] } })
  return (r.data?.['saveProduct'] as { id: string } | undefined)?.id ?? ''
}
const verify = (secret: string, body: string, header: string | undefined) => {
  const [t1, v1] = (header ?? '').split(',').map((p) => p.split('=')[1] ?? '')
  return v1 === createHmac('sha256', secret).update(`${t1}.${body}`).digest('hex')
}

describe('Saving an endpoint', () => {
  it('shows its signing secret once, keeps it sealed, and never reads it back', async () => {
    const { saved, code } = await save('owner', 'https://hooks.shop.example/in', ['product.updated'])
    expect(code).toBeUndefined()
    expect(saved?.secret).toMatch(/^whsec_[0-9A-Za-z]{32}$/)
    const [row] = await db.sql<{ secret_sealed: string }[]>`select secret_sealed from webhook_endpoint where id = ${saved?.id ?? ''}`
    expect(row?.secret_sealed).not.toContain(saved?.secret ?? 'x')
    expect(await secrets.open(row?.secret_sealed ?? '')).toBe(saved?.secret)
    const again = await save('owner', 'https://hooks.shop.example/in2', ['product.updated', 'order.placed'], saved?.id)
    expect(again.saved).toEqual({ id: saved?.id, secret: null })
    expect((await endpoints('owner')).list?.find((e) => e.id === saved?.id)).toMatchObject({ url: 'https://hooks.shop.example/in2', events: ['order.placed', 'product.updated'], status: 'active' })
    await expect(withScope(db.sql, { caller: { kind: 'person', userId: w.people.owner, sessionId: 's' }, partnerId: t.partnerA, storeId: t.storeA1, sellerScope: { kind: 'all' }, subscription: 'active' }, (tx) => tx`select secret_sealed from webhook_endpoint`)).rejects.toThrow(/permission denied/)
    const entries = await db.sql<{ action: string; text: string }[]>`select action, row_to_json(a)::text as text from activity_log a where target_id = ${saved?.id ?? ''} order by occurred_at`
    expect(entries.map((e) => e.action)).toEqual(['webhook.saved', 'webhook.saved'])
    expect(entries.some((e) => e.text.includes(saved?.secret ?? 'x'))).toBe(false)
    await w.gql('owner', 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id: saved?.id })
  })

  it('refuses plain http, private, loopback, link-local and metadata addresses, and an event it doesn’t know', async () => {
    expect((await save('owner', 'http://hooks.shop.example/in', ['order.placed'])).code).toBe('BAD_URL')
    expect((await save('owner', 'https://127.0.0.1/in', ['order.placed'])).code).toBe('BAD_URL')
    expect((await save('owner', 'https://localhost/in', ['order.placed'])).code).toBe('BAD_URL')
    for (const host of ['inside', 'meta', 'local']) expect((await save('owner', `https://${host}.shop.example/in`, ['order.placed'])).code, host).toBe('PRIVATE_ADDRESS')
    expect((await save('owner', 'https://nowhere.shop.example/in', ['order.placed'])).code).toBe('BAD_URL')
    expect((await save('owner', 'https://hooks.shop.example/in', ['order.deleted'])).code).toBe('INVALID_INPUT')
    expect((await save('owner', 'https://hooks.shop.example/in', [])).code).toBe('INVALID_INPUT')
  })

  it('is the Owner’s alone, and another store’s Owner sees and reaches none of it', async () => {
    const { saved } = await save('owner', 'https://hooks.shop.example/a1', ['order.placed'])
    for (const who of ['manager', 'staff', 'supplier'] as const) {
      expect((await endpoints(who)).code, who).toBe('FORBIDDEN')
      expect((await save(who, 'https://hooks.shop.example/x', ['order.placed'])).code, who).toBe('FORBIDDEN')
      expect((await deliveries(who, saved?.id ?? '')).code, who).toBe('FORBIDDEN')
    }
    for (const who of ['a2Owner', 'bOwner'] as const) {
      expect((await endpoints(who)).list?.map((e) => e.id), who).not.toContain(saved?.id)
      expect((await deliveries(who, saved?.id ?? '')).list, who).toEqual([])
      expect((await save(who, 'https://hooks.shop.example/x', ['order.placed'], saved?.id)).code, who).toBe('NOT_FOUND')
      expect((await w.gql(who, 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id: saved?.id })).code, who).toBe('NOT_FOUND')
      expect((await w.gql(who, 'mutation R($id: ID!) { turnOnWebhook(id: $id) }', { id: saved?.id })).code, who).toBe('NOT_FOUND')
    }
    await w.gql('owner', 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id: saved?.id })
  })
})

describe('Delivering', () => {
  it('delivers a store’s event signed to its endpoint, and sends it again on replay', async () => {
    const { saved } = await save('owner', 'https://hooks.shop.example/live', ['product.updated'])
    const secret = saved?.secret ?? ''
    const productId = await product('owner', 'Webhook lamp')
    await relay()
    await relay()
    expect(endpoint.sent).toHaveLength(1)
    const first = endpoint.sent[0]
    expect(first?.url).toBe('https://hooks.shop.example/live')
    expect(verify(secret, first?.body ?? '', first?.headers['dripfunnel-signature'])).toBe(true)
    expect(JSON.parse(first?.body ?? '{}')).toMatchObject({ type: 'product.updated', store: t.storeA1, data: { object: 'product', id: productId } })
    const log = (await deliveries('owner', saved?.id ?? '')).list ?? []
    expect(log).toMatchObject([{ event: 'product.updated', status: 'delivered', attempts: 1, responseCode: 200, error: null, replayOf: null }])
    expect(first?.headers['dripfunnel-delivery']).toBe(log[0]?.id)

    const again = await replay('owner', log[0]?.id ?? '')
    expect(again.code).toBeUndefined()
    await relay()
    expect(endpoint.sent).toHaveLength(2)
    expect(endpoint.sent[1]?.body).toBe(first?.body)
    expect(endpoint.sent[1]?.headers['dripfunnel-delivery']).toBe(again.id)
    const after = (await deliveries('owner', saved?.id ?? '')).list ?? []
    expect(after.find((d) => d.id === again.id)).toMatchObject({ status: 'delivered', replayOf: log[0]?.id, eventId: log[0]?.eventId })
    expect((await replay('a2Owner', log[0]?.id ?? '')).code).toBe('NOT_FOUND')
    expect((await db.sql<{ action: string }[]>`select action from activity_log where target_id = ${saved?.id ?? ''} and action = 'webhook.delivery_replayed'`)).toHaveLength(1)
    await w.gql('owner', 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id: saved?.id })
  })

  it('queues nothing for a store whose endpoints don’t take the event, and a supplier’s change reaches its store’s endpoint', async () => {
    const before = (await db.sql`select 1 from outbox where kind = ${storeEventKind}`).length
    await product('a2Owner', 'Unwatched')
    expect(await db.sql`select 1 from outbox where kind = ${storeEventKind}`).toHaveLength(before)
    const { saved } = await save('owner', 'https://hooks.shop.example/supplier', ['product.updated'])
    const supplierProduct = await product('supplier', 'Supplier scarf')
    const queued = await db.sql<{ data: { id: string } }[]>`select payload->'data' as data from outbox where kind = ${storeEventKind} and store_id = ${t.storeA1} order by created_at desc limit 1`
    expect(queued[0]?.data.id).toBe(supplierProduct)
    await relay()
    await w.gql('owner', 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id: saved?.id })
  })

  it('makes one delivery per endpoint however many times its fan-out runs', async () => {
    const { saved } = await save('owner', 'https://hooks.shop.example/once', ['product.updated'])
    await product('owner', 'Fan-out')
    const [row] = await db.sql<{ id: string; idempotency_key: string; payload: unknown; partner_id: string; store_id: string }[]>`select id, idempotency_key, payload, partner_id, store_id from outbox where kind = ${storeEventKind} order by created_at desc limit 1`
    const effect = { id: row?.id ?? '', kind: storeEventKind, idempotencyKey: row?.idempotency_key ?? '', payload: row?.payload, partnerId: row?.partner_id ?? null, storeId: row?.store_id ?? null, attempt: 1 }
    const fan = webhookEventDeliverer(db.sql, () => now)
    await Promise.all([fan.deliver(effect, new AbortController().signal), fan.deliver(effect, new AbortController().signal), fan.deliver(effect, new AbortController().signal)])
    expect(await db.sql`select 1 from webhook_delivery where endpoint_id = ${saved?.id ?? ''}`).toHaveLength(1)
    await relay()
    await relay()
    await w.gql('owner', 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id: saved?.id })
  })

  it('checks the address again on every delivery: a name now pointing inside is refused before any request', async () => {
    dns.set('A moving.shop.example', ['93.184.216.40'])
    const { saved } = await save('owner', 'https://moving.shop.example/in', ['product.updated'])
    dns.set('A moving.shop.example', ['10.9.9.9'])
    const sentBefore = endpoint.sent.length
    await product('owner', 'Moved')
    await relay()
    await relay()
    expect(endpoint.sent).toHaveLength(sentBefore)
    expect((await deliveries('owner', saved?.id ?? '')).list?.[0]).toMatchObject({ status: 'pending', attempts: 1, error: 'private_address', responseCode: null })
    expect((await endpoints('owner')).list?.find((e) => e.id === saved?.id)?.status).toBe('failing')
    // Replay checks it too.
    const d = (await deliveries('owner', saved?.id ?? '')).list?.[0]
    expect((await replay('owner', d?.id ?? '')).code).toBe('PRIVATE_ADDRESS')
    await w.gql('owner', 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id: saved?.id })
    // A removed endpoint's waiting delivery ends there.
    await db.sql`update outbox set next_attempt_at = now() - interval '1 second' where kind = ${webhookDeliveryKind} and delivered_at is null and failed_at is null`
    await relay()
    expect((await db.sql<{ status: string; error: string }[]>`select status, error from webhook_delivery where id = ${d?.id ?? ''}`)[0]).toEqual({ status: 'failed', error: 'endpoint_removed' })
  })

  it('retries a failing endpoint with growing waits up to the relay’s limit, then marks the delivery failed', async () => {
    const { saved, code: savedCode } = await save('owner', 'https://other.shop.example/flaky', ['product.updated'])
    expect(savedCode).toBeUndefined()
    answer = 500
    try {
      await product('owner', 'Flaky')
      await relay()
      const start = now
      const waits: number[] = []
      for (let i = 0; i < defaultRelayOptions.maxAttempts + 2; i++) {
        await relay()
        const [o] = await db.sql<{ attempts: number; next_attempt_at: Date; failed_at: Date | null }[]>`
          select o.attempts, o.next_attempt_at, o.failed_at from outbox o join webhook_delivery d on (o.payload->>'deliveryId')::uuid = d.id where d.endpoint_id = ${saved?.id ?? ''}`
        if (!o || o.failed_at) break
        waits.push(o.next_attempt_at.getTime() - now.getTime())
        now = new Date(o.next_attempt_at.getTime() + 1)
      }
      // Back to the sessions' own time: hours went by for the relay alone.
      now = start
      expect(waits.length).toBeGreaterThan(2)
      expect(waits.every((wait, i) => i === 0 || wait >= (waits[i - 1] ?? 0))).toBe(true)
      const [d] = (await deliveries('owner', saved?.id ?? '')).list ?? []
      expect(d).toMatchObject({ status: 'failed', attempts: defaultRelayOptions.maxAttempts, responseCode: 500, error: 'status' })
    } finally {
      answer = 200
      await w.gql('owner', 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id: saved?.id })
    }
  })
})

describe('Turning off and back on', () => {
  it('turns an endpoint off after 3 days of failures, tells the Owners once, holds what follows, and sends it when turned back on', async () => {
    const { saved } = await save('owner', 'https://hooks.shop.example/off', ['product.updated'])
    const id = saved?.id ?? ''
    answer = 503
    try {
      await product('owner', 'First failure')
      await relay()
      await relay()
      expect((await endpoints('owner')).list?.find((e) => e.id === id)?.status).toBe('failing')
      // Three days of failures later.
      await db.sql`update webhook_endpoint set failing_since = ${new Date(now.getTime() - 3 * 86_400_000 - 1000)} where id = ${id}`
      await product('owner', 'The last straw')
      await relay()
      await relay()
      expect((await endpoints('owner')).list?.find((e) => e.id === id)?.status).toBe('disabled')
      const emails = await db.sql`select 1 from outbox where kind = 'email' and payload->>'template' = 'webhook-disabled' and store_id = ${t.storeA1}`
      expect(emails).toHaveLength(1)
      // Off: new events wait, and nothing is sent or replayed to it.
      const sentBefore = endpoint.sent.length
      await product('owner', 'While off')
      await relay()
      await relay()
      expect(endpoint.sent).toHaveLength(sentBefore)
      const held = ((await deliveries('owner', id)).list ?? []).filter((d) => d.status === 'held')
      expect(held.length).toBeGreaterThanOrEqual(2)
      expect((await replay('owner', held[0]?.id ?? '')).code).toBe('ENDPOINT_OFF')
      // A held event older than the week stays held when it's turned back on.
      await db.sql`update webhook_delivery set created_at = ${new Date(now.getTime() - 8 * 86_400_000)} where id = ${held.at(-1)?.id ?? ''}`
      answer = 200
      const released = await w.gql('owner', 'mutation R($id: ID!) { turnOnWebhook(id: $id) }', { id })
      expect(released.data?.['turnOnWebhook']).toBe(held.length - 1)
      await relay()
      expect(endpoint.sent.length).toBe(sentBefore + held.length - 1)
      expect((await endpoints('owner')).list?.find((e) => e.id === id)).toMatchObject({ status: 'active', failingSince: null })
      expect((await replay('owner', held.at(-1)?.id ?? '')).code).toBe('TOO_OLD')
    } finally {
      answer = 200
      await w.gql('owner', 'mutation R($id: ID!) { removeWebhook(id: $id) }', { id })
    }
  })
})
