import type postgres from 'postgres'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { withSystemScope } from '#db/scoped/index'
import { ExpoPushRefused, ExpoPushUnavailable, type ExpoPush, type PushMessage } from '#integrations/expoPush/index'
import { pushDeliverer, pushReceiptsDeliverer } from '#jobs/queues/deliverers/push'
import { defaultRelayOptions, relayDue, type Deliverers } from '#jobs/queues/outbox-relay'
import { pushKind, pushReceiptsKind, queuePush, receiptsAfterMs, receiptsKeptMs, type PushPayload } from '#saas/push/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { captureLogs, metricKeys } from './support/metrics'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #840 (DL 3): pushes through the outbox to a subject's phones by Expo, and the receipts read after (DELIVERY §6).

let db: TestDatabase
let t: Tenants
let storeName = ''

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
  storeName = (await db.sql<{ name: string }[]>`select name from store where id = ${t.storeA1}`)[0]?.name ?? ''
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

beforeEach(async () => {
  await db.sql`delete from outbox where kind in (${pushKind}, ${pushReceiptsKind})`
  await db.sql`delete from push_device`
})

const token = (n: number) => `ExponentPushToken[phone-${n}]`

/** Expo as the tests want it: what each send carried, tickets refused per token, receipts per ticket, and one failure. */
const fakeExpo = () => {
  const sends: PushMessage[][] = []
  const deadTokens = new Set<string>()
  const receipts = new Map<string, string | null>()
  const asked: string[][] = []
  let next: Error | null = null
  const fail = () => {
    if (!next) return
    const error = next
    next = null
    throw error
  }
  let tickets = 0
  const expo: ExpoPush = {
    send: async (messages) => {
      fail()
      sends.push([...messages])
      return messages.map((m) => (deadTokens.has(m.to) ? { id: null, error: 'DeviceNotRegistered' } : { id: `ticket-${++tickets}`, error: null }))
    },
    receipts: async (ids) => {
      fail()
      asked.push([...ids])
      return new Map(ids.filter((id) => receipts.has(id)).map((id) => [id, receipts.get(id) ?? null]))
    },
  }
  return { expo, sends, deadTokens, receipts, asked, failNext: (error: Error) => (next = error) }
}

const dbNow = async (): Promise<Date> => {
  const [row] = await db.sql<{ now: Date }[]>`select now() as now`
  if (!row) throw new Error('the test database gave no clock')
  return row.now
}

/** The relay `aheadMs` from the database's now, its deliverers running by the same clock. */
const relay = async (expo: ExpoPush, o: { aheadMs?: number; maxAttempts?: number; kinds?: 'both' | 'none'; sql?: postgres.Sql } = {}) => {
  const at = new Date((await dbNow()).getTime() + 1000 + (o.aheadMs ?? 0))
  const deliverers: Deliverers = o.kinds === 'none' ? { unrelated: { deliver: async () => undefined } } : { [pushKind]: pushDeliverer(o.sql ?? db.sql, expo, () => at), [pushReceiptsKind]: pushReceiptsDeliverer(db.sql, expo, () => at) }
  return relayDue(db.sql, deliverers, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0, maxAttempts: o.maxAttempts ?? defaultRelayOptions.maxAttempts })
}

const device = async (subjectId: string, n: number, storeId = t.storeA1) =>
  (await db.sql<{ id: string }[]>`insert into push_device (store_id, subject_kind, subject_id, expo_token, platform) values (${storeId}, 'rider', ${subjectId}, ${token(n)}, 'android') returning id`)[0]?.id ?? ''

const queue = (payload: PushPayload, o: { partnerId?: string; storeId?: string } = {}) =>
  withSystemScope(db.sql, (tx) => queuePush(tx, { partnerId: o.partnerId ?? t.partnerA, storeId: o.storeId ?? t.storeA1, idempotencyKey: crypto.randomUUID(), payload }))

const notice = (riderId: string, extra: Partial<PushPayload> = {}): PushPayload => ({ subject: { kind: 'rider', id: riderId }, message: 'rider.notifications_on', ...extra })

const row = async (id: string | null) =>
  (await db.sql<{ payload: Record<string, unknown>; delivered_at: Date | null; failed_at: Date | null; last_error: string | null; attempts: number }[]>`select payload, delivered_at, failed_at, last_error, attempts from outbox where id = ${id ?? ''}`)[0]
const receiptsRows = () => db.sql<{ id: string; payload: { tickets: { ticketId: string; deviceId: string }[] }; next_attempt_at: Date; created_at: Date }[]>`select id, payload, next_attempt_at, created_at from outbox where kind = ${pushReceiptsKind}`
const devicesLeft = async () => (await db.sql<{ id: string }[]>`select id from push_device order by id`).map((d) => d.id)

/** No address, phone, amount or handover code, as a key or a value (DELIVERY §3, §6). */
const forbidden = /address|phone|amount|price|total|code|pin|\+\d{7,}|\d{6}/i
const keysAndValues = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.flatMap(keysAndValues)
    : value !== null && typeof value === 'object'
      ? Object.entries(value).flatMap(([k, v]) => [k, ...keysAndValues(v)])
      : [String(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '')]

describe('pushes through the outbox (DELIVERY §6)', () => {
  it('sends dispatch events with IDs only, and the taken update is silent', async () => {
    const { expo, sends } = fakeExpo()
    const riderId = crypto.randomUUID()
    const deliveryId = crypto.randomUUID()
    await device(riderId, 1)
    for (const message of ['rider.offer', 'rider.assigned', 'rider.taken', 'rider.cancelled'] as const) {
      await queue({ subject: { kind: 'rider', id: riderId }, message, deliveryId })
    }
    await relay(expo)
    const messages = sends.flat()
    expect(messages).toHaveLength(4)
    for (const sent of messages) expect(Object.keys(sent.data).sort()).toEqual(['deliveryId', 'kind'])
    expect(messages.find((m) => m.data['kind'] === 'rider.taken')?.silent).toBe(true)
  })
  it('sends every phone of the subject in one call, in the store’s words, and reads the receipts 15 minutes later', async () => {
    const { expo, sends } = fakeExpo()
    const riderId = crypto.randomUUID()
    const phones = [await device(riderId, 1), await device(riderId, 2), await device(riderId, 3)]
    await device(crypto.randomUUID(), 4)
    const id = await queue(notice(riderId))
    expect((await relay(expo)).delivered).toBe(1)
    expect(sends).toHaveLength(1)
    expect(sends[0]?.map((m) => m.to).sort()).toEqual([token(1), token(2), token(3)])
    expect(sends[0]?.[0]).toMatchObject({ subject: `rider:${riderId}`, title: storeName, body: `Notifications are on for ${storeName}.`, data: { kind: 'rider.notifications_on' } })
    expect((await row(id))?.payload).toEqual({ message: 'rider.notifications_on', redacted: true })
    const [receipts] = await receiptsRows()
    expect(receipts?.payload.tickets.map((x) => x.deviceId).sort()).toEqual([...phones].sort())
    expect(JSON.stringify(receipts?.payload)).not.toContain('ExponentPushToken')
    expect((receipts?.next_attempt_at.getTime() ?? 0) - Date.now()).toBeGreaterThan(receiptsAfterMs - 120_000)
  })

  it('never puts an address, a phone, an amount or a code in the payload or in what is sent', async () => {
    const { expo, sends } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 5)
    const deliveryId = crypto.randomUUID()
    const queued = notice(riderId, { deliveryId })
    const id = await queue(queued)
    const [stored] = await db.sql<{ payload: unknown }[]>`select payload from outbox where id = ${id ?? ''}`
    expect(keysAndValues(stored?.payload).filter((s) => forbidden.test(s))).toEqual([])
    await relay(expo)
    const sent = sends[0]?.[0]
    expect(sent?.data).toEqual({ kind: 'rider.notifications_on', deliveryId })
    expect(keysAndValues({ title: sent?.title, body: sent?.body, data: sent?.data }).filter((s) => forbidden.test(s))).toEqual([])
    // Free text, or more than the kind and an id, never reaches the outbox.
    await expect(queue({ ...queued, address: '12 MG Road' } as unknown as PushPayload)).rejects.toThrow()
    await expect(queue({ ...queued, phone: '+919811100001' } as unknown as PushPayload)).rejects.toThrow()
    await expect(queue(notice(riderId, { deliveryId, orderId: crypto.randomUUID() }))).rejects.toThrow()
  })

  it('retries an unavailable Expo with the relay’s backoff, and gives up at the attempt limit', async () => {
    const { expo, sends, failNext } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 6)
    const id = await queue(notice(riderId))
    failNext(new ExpoPushUnavailable('answered 503'))
    expect((await relay(expo)).retry).toBe(1)
    expect(await row(id)).toMatchObject({ last_error: 'failed', delivered_at: null, failed_at: null })
    expect((await relay(expo)).delivered).toBe(1)
    expect(sends).toHaveLength(1)

    const dead = await queue(notice(riderId))
    failNext(new ExpoPushUnavailable('no answer'))
    expect((await relay(expo, { maxAttempts: 1 })).dead).toBe(1)
    expect((await row(dead))?.payload).toEqual({ message: 'rider.notifications_on', redacted: true })
  })

  it('drops a push Expo refuses, under Expo’s code only', async () => {
    const { expo, failNext } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 7)
    const id = await queue(notice(riderId))
    failNext(new ExpoPushRefused('expo_PUSH_TOO_MANY_EXPERIENCE_IDS'))
    expect((await relay(expo)).dropped).toBe(1)
    expect(await row(id)).toMatchObject({ last_error: 'expo_PUSH_TOO_MANY_EXPERIENCE_IDS', payload: { message: 'rider.notifications_on', redacted: true } })
  })

  it('leaves pushes waiting while no Expo is configured', async () => {
    const { expo } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 8)
    const id = await queue(notice(riderId))
    await relay(expo, { kinds: 'none' })
    expect(await row(id)).toMatchObject({ attempts: 0, delivered_at: null, failed_at: null })
  })

  it('delivers to nobody once the subject has no phone, and refuses a row whose store isn’t its partner’s', async () => {
    const { expo, sends } = fakeExpo()
    const nobody = await queue(notice(crypto.randomUUID()))
    const riderId = crypto.randomUUID()
    await device(riderId, 9)
    const crossed = await queue(notice(riderId), { partnerId: t.partnerB })
    const counts = await relay(expo)
    expect([counts.delivered, counts.dropped]).toEqual([1, 1])
    expect((await row(nobody))?.delivered_at).not.toBeNull()
    expect((await row(crossed))?.last_error).toBe('no_store')
    expect(sends).toHaveLength(0)
  })
})

describe('push failures, measured and logged (DELIVERY §3)', () => {
  it('counts a send Expo refuses once, by its error code and the store alone', async () => {
    const logs = captureLogs()
    const { expo, deadTokens } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 20)
    await device(riderId, 21)
    deadTokens.add(token(20))
    await queue(notice(riderId))
    await relay(expo)
    const sent = logs.metrics('push_send_failed')
    logs.restore()
    expect(sent).toEqual([{ event: 'metric', api: 'system', storeId: t.storeA1, metric: 'push_send_failed', value: 1, code: 'DeviceNotRegistered' }])
    expect(Object.keys(sent[0] ?? {}).every((key) => metricKeys.includes(key))).toBe(true)
  })

  it('counts a refused send once even when the rows after it fail and the relay sends the push again', async () => {
    const logs = captureLogs()
    const { expo, deadTokens } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 25)
    deadTokens.add(token(25))
    const id = await queue(notice(riderId))
    // The first transaction reads the phones; the second deletes the dead one and queues the receipts, and it fails here.
    let transactions = 0
    const flaky = new Proxy(db.sql, {
      get: (target, key, receiver) => (key === 'begin' && ++transactions === 2 ? () => Promise.reject(new Error('connection lost')) : Reflect.get(target, key, receiver) as unknown),
    })
    expect((await relay(expo, { sql: flaky })).retry).toBe(1)
    expect(logs.metrics('push_send_failed')).toEqual([])
    expect((await relay(expo)).delivered).toBe(1)
    const counted = logs.metrics('push_send_failed')
    logs.restore()
    expect(counted.map((m) => m.code)).toEqual(['DeviceNotRegistered'])
    expect((await row(id))?.delivered_at).not.toBeNull()
  })

  it('counts the receipt errors once, on the last pass, not on each time Expo is asked again', async () => {
    const logs = captureLogs()
    const { expo, receipts } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 22)
    await device(riderId, 23)
    await queue(notice(riderId))
    await relay(expo)
    const [pending] = await receiptsRows()
    const [first, second] = pending?.payload.tickets.map((x) => x.ticketId) ?? []
    receipts.set(first ?? '', 'MessageRateExceeded')
    expect((await relay(expo, { aheadMs: receiptsAfterMs })).retry).toBe(1)
    expect(logs.metrics('push_send_failed')).toEqual([])
    receipts.set(second ?? '', null)
    expect((await relay(expo, { aheadMs: 2 * receiptsAfterMs })).delivered).toBe(1)
    const counted = logs.metrics('push_send_failed')
    logs.restore()
    expect(counted.map((m) => [m.code, m.value, m.storeId])).toEqual([['MessageRateExceeded', 1, t.storeA1]])
  })

  it('logs a send that failed outright under its class, never its message, and counts nothing', async () => {
    const logs = captureLogs()
    const { expo, failNext } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 24)
    await queue(notice(riderId))
    failNext(new ExpoPushUnavailable('answered 503 for ExponentPushToken[phone-24]'))
    await relay(expo)
    const lines = logs.lines()
    logs.restore()
    expect(lines).toContainEqual(expect.objectContaining({ event: 'push_failed', storeId: t.storeA1, code: 'ExpoPushUnavailable' }))
    expect(JSON.stringify(lines)).not.toContain('phone-24')
    expect(lines.filter((line) => line['event'] === 'metric')).toEqual([])
  })
})

describe('dead phones (DELIVERY §6)', () => {
  it('deletes a phone at once when its ticket says DeviceNotRegistered', async () => {
    const { expo, deadTokens } = fakeExpo()
    const riderId = crypto.randomUUID()
    const gone = await device(riderId, 10)
    const kept = await device(riderId, 11)
    deadTokens.add(token(10))
    await queue(notice(riderId))
    expect((await relay(expo)).delivered).toBe(1)
    expect(await devicesLeft()).toEqual([kept])
    expect((await receiptsRows())[0]?.payload.tickets.map((x) => x.deviceId)).toEqual([kept])
    expect(gone).not.toBe(kept)
  })

  it('reads receipts once due, deletes a phone Expo answers DeviceNotRegistered, and waits for ones not ready', async () => {
    const { expo, receipts, asked } = fakeExpo()
    const riderId = crypto.randomUUID()
    const [first, second, third] = [await device(riderId, 12), await device(riderId, 13), await device(riderId, 14)]
    await queue(notice(riderId))
    await relay(expo)
    const [pending] = await receiptsRows()
    const ticketOf = (deviceId: string) => pending?.payload.tickets.find((x) => x.deviceId === deviceId)?.ticketId ?? ''
    // Not due before 15 minutes.
    await relay(expo)
    expect(asked).toHaveLength(0)
    receipts.set(ticketOf(first), 'DeviceNotRegistered')
    receipts.set(ticketOf(second), null)
    expect((await relay(expo, { aheadMs: receiptsAfterMs })).retry).toBe(1)
    expect(asked[0]?.sort()).toEqual([ticketOf(first), ticketOf(second), ticketOf(third)].sort())
    expect((await devicesLeft()).sort()).toEqual([second, third].sort())
    expect(await row(pending?.id ?? null)).toMatchObject({ last_error: 'receipts_pending', attempts: 0, delivered_at: null })
    receipts.set(ticketOf(third), 'MessageRateExceeded')
    expect((await relay(expo, { aheadMs: 2 * receiptsAfterMs })).delivered).toBe(1)
    expect((await devicesLeft()).sort()).toEqual([second, third].sort())
  })

  it('stops asking a day after the send, with receipts still missing', async () => {
    const { expo } = fakeExpo()
    const riderId = crypto.randomUUID()
    await device(riderId, 15)
    await queue(notice(riderId))
    await relay(expo)
    const [pending] = await receiptsRows()
    expect((await relay(expo, { aheadMs: receiptsKeptMs + 60_000 })).delivered).toBe(1)
    expect((await row(pending?.id ?? null))?.delivered_at).not.toBeNull()
  })
})
