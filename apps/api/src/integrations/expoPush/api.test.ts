import { describe, expect, it } from 'vitest'
import { expoPushClient, ExpoPushRefused, ExpoPushUnavailable, maxPushMessages, type PushMessage } from './api'

const token = (n: number) => `ExponentPushToken[device${n}]`
const message = (n: number): PushMessage => ({ to: token(n), subject: 'rider:r-1', title: 'Kesari Threads', body: 'Notifications are on.', data: { kind: 'rider.notifications_on' } })

/** Answers each call in turn from `answers`, recording what was asked. */
const recording = (answers: (Response | Error | ((body: unknown) => Response))[], seen: { url: string; headers: Headers; body: unknown }[] = []) =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const body: unknown = await request.json()
    seen.push({ url: request.url, headers: request.headers, body })
    const next = answers.shift() ?? new Response('{}', { status: 200 })
    if (next instanceof Error) throw next
    return typeof next === 'function' ? next(body) : next
  }) as typeof fetch

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const ticketsFor = (body: unknown) => json(200, { data: (body as unknown[]).map((_, i) => ({ status: 'ok', id: `t-${i}` })) })

describe('the Expo push client', () => {
  it('sends taken updates without a title, body or sound', async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = []
    await expoPushClient({ token: 'expo-access', fetchImpl: recording([ticketsFor], seen) }).send([{ ...message(0), silent: true, data: { kind: 'rider.taken', deliveryId: 'delivery-id' } }])
    expect(seen[0]?.body).toEqual([{ to: token(0), data: { kind: 'rider.taken', deliveryId: 'delivery-id' }, _contentAvailable: true }])
  })
  it('sends at most 100 messages a call, with the access token, and never the subject', async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = []
    const messages = Array.from({ length: maxPushMessages + 1 }, (_, n) => message(n))
    const tickets = await expoPushClient({ token: 'expo-access', fetchImpl: recording([ticketsFor, ticketsFor], seen) }).send(messages)
    expect(seen.map((s) => (s.body as unknown[]).length)).toEqual([100, 1])
    expect(seen[0]?.url).toBe('https://exp.host/--/api/v2/push/send')
    expect(seen[0]?.headers.get('authorization')).toBe('Bearer expo-access')
    expect((seen[0]?.body as unknown[])[0]).toEqual({ to: token(0), title: 'Kesari Threads', body: 'Notifications are on.', data: { kind: 'rider.notifications_on' }, sound: 'default' })
    expect(tickets).toHaveLength(101)
    expect(tickets[100]).toEqual({ id: 't-0', error: null })
  })

  it('reads DeviceNotRegistered from a ticket by its place, and counts an unreadable 2xx as sent', async () => {
    const answered = await expoPushClient({ token: 'k', fetchImpl: recording([json(200, { data: [{ status: 'ok', id: 'a' }, { status: 'error', message: `"${token(1)}" is not registered`, details: { error: 'DeviceNotRegistered' } }] })]) }).send([message(0), message(1)])
    expect(answered).toEqual([{ id: 'a', error: null }, { id: null, error: 'DeviceNotRegistered' }])
    expect(JSON.stringify(answered)).not.toContain(token(1))
    expect(await expoPushClient({ token: 'k', fetchImpl: recording([new Response('not json', { status: 200 })]) }).send([message(0)])).toEqual([{ id: null, error: null }])
  })

  it('treats no answer, throttling, an outage and a refused access token as worth retrying', async () => {
    for (const status of [429, 500, 503, 401, 403]) {
      await expect(expoPushClient({ token: 'k', fetchImpl: recording([json(status, {})]) }).send([message(0)]), String(status)).rejects.toBeInstanceOf(ExpoPushUnavailable)
    }
    await expect(expoPushClient({ token: 'k', fetchImpl: recording([new Error('reset')]) }).send([message(0)])).rejects.toBeInstanceOf(ExpoPushUnavailable)
  })

  it('gives up on a hanging call when the relay’s signal ends it', async () => {
    const hanging = (async (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))))) as typeof fetch
    const controller = new AbortController()
    const pending = expoPushClient({ token: 'k', fetchImpl: hanging }).send([message(0)], controller.signal)
    controller.abort()
    await expect(pending).rejects.toBeInstanceOf(ExpoPushUnavailable)
  })

  it('refuses for good on any other 4xx, keeping only Expo’s code', async () => {
    const refused = expoPushClient({ token: 'k', fetchImpl: recording([json(400, { errors: [{ code: 'PUSH_TOO_MANY_EXPERIENCE_IDS', message: `${token(0)} and ${token(1)}` }] })]) }).send([message(0)])
    await expect(refused).rejects.toEqual(new ExpoPushRefused('expo_PUSH_TOO_MANY_EXPERIENCE_IDS'))
    await expect(expoPushClient({ token: 'k', fetchImpl: recording([json(413, null)]) }).send([message(0)])).rejects.toEqual(new ExpoPushRefused('expo_413'))
  })

  it('reads receipts 300 ids a call: delivered, DeviceNotRegistered, and none yet', async () => {
    const seen: { url: string; headers: Headers; body: unknown }[] = []
    const ids = Array.from({ length: 301 }, (_, n) => `t-${n}`)
    const receipts = await expoPushClient({ token: 'k', fetchImpl: recording([json(200, { data: { 't-0': { status: 'ok' }, 't-1': { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } } } }), json(200, { data: {} })], seen) }).receipts(ids)
    expect(seen.map((s) => (s.body as { ids: string[] }).ids.length)).toEqual([300, 1])
    expect(seen[0]?.url).toBe('https://exp.host/--/api/v2/push/getReceipts')
    expect([...receipts]).toEqual([['t-0', null], ['t-1', 'DeviceNotRegistered']])
    await expect(expoPushClient({ token: 'k', fetchImpl: recording([new Response('nope', { status: 200 })]) }).receipts(['t-0'])).rejects.toBeInstanceOf(ExpoPushUnavailable)
  })
})
