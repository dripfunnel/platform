import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SmsRefused, SmsUnavailable, type OutgoingSms, type SmsSender } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import { expireUnsentSms } from '#db/scoped/outbox'
import { smsDeliverer, type SmsSenders } from '#jobs/queues/deliverers/sms'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { queueSms, type PartnerSmsAccount, type PartnerSmsAccounts, type SmsPayload } from '#saas/sms/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #289: texts through the outbox, by the partner's own account for the number's country.

let db: TestDatabase
let t: Tenants
const now = new Date('2026-10-05T09:00:00Z')

beforeAll(async () => {
  db = await createTestDatabase()
  t = await seedTenants(db.sql)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

/** Each partner's accounts, as #275 will read them; partner B has none. */
const accountsOf = (byPartner: Record<string, PartnerSmsAccount[]>): PartnerSmsAccounts => ({
  forPartner: async (_tx, partnerId, provider) => byPartner[partnerId]?.find((a) => a.provider === provider) ?? null,
})

const fakeSenders = () => {
  const sent: { provider: string; sms: OutgoingSms }[] = []
  let next: Error | null = null
  const sender = (provider: string): SmsSender => ({
    send: async (sms) => {
      if (next) {
        const error = next
        next = null
        throw error
      }
      sent.push({ provider, sms })
      return { providerId: `p-${sent.length}` }
    },
  })
  const senders: SmsSenders = { msg91: () => sender('msg91'), twilio: () => sender('twilio') }
  return { senders, sent, failNext: (error: Error) => (next = error) }
}

const code = (to: string, extra: Partial<SmsPayload> = {}): SmsPayload => ({ message: 'code.second_factor', to, brand: 'Northstar', vars: { code: '482913' }, expiresAt: new Date(now.getTime() + 600_000).toISOString(), ...extra })

const queue = (partnerId: string, payload: SmsPayload) =>
  withSystemScope(db.sql, (tx) => queueSms(tx, { partnerId, storeId: null, idempotencyKey: `sms:${crypto.randomUUID()}`, payload }))

const relay = (accounts: PartnerSmsAccounts, senders: SmsSenders) =>
  relayDue(db.sql, { sms: smsDeliverer(db.sql, accounts, senders, () => now) }, { ...defaultRelayOptions, now: () => new Date(now.getTime() + 1000), baseDelayMs: 0 })

const msg91: PartnerSmsAccount = { provider: 'msg91', authKey: 'k', templates: { 'code.second_factor': 'tmpl-2fa' } }
const twilio: PartnerSmsAccount = { provider: 'twilio', accountSid: 'AC1', authToken: 't', messagingServiceSid: 'MG1' }

const pending = async () => (await db.sql<{ n: number }[]>`select count(*)::int as n from outbox where kind = 'sms' and delivered_at is null and failed_at is null`)[0]?.n

describe('texts through the outbox', () => {
  it('sends an Indian number through MSG91 with the DLT template, and a US one through Twilio as text', async () => {
    const { senders, sent } = fakeSenders()
    await queue(t.partnerA, code('+919845022113'))
    await queue(t.partnerA, code('+16145550199'))
    const counts = await relay(accountsOf({ [t.partnerA]: [msg91, twilio] }), senders)
    expect(counts.delivered).toBe(2)
    expect(sent.find((s) => s.provider === 'msg91')?.sms.dlt).toEqual({ templateId: 'tmpl-2fa', vars: ['Northstar', '482913'] })
    expect(sent.find((s) => s.provider === 'twilio')?.sms).toMatchObject({ to: '+16145550199', dlt: null })
  })

  it('keeps no number or code in the outbox once a text is sent or dropped', async () => {
    const { senders } = fakeSenders()
    const sentId = await queue(t.partnerA, code('+16145550199'))
    const expiredId = await queue(t.partnerA, code('+919845022113', { expiresAt: new Date(now.getTime() - 1000).toISOString() }))
    await relay(accountsOf({ [t.partnerA]: [twilio] }), senders)
    const rows = await db.sql<{ payload: Record<string, unknown> }[]>`select payload from outbox where id in ${db.sql([sentId ?? '', expiredId ?? ''])}`
    expect(rows.map((r) => r.payload)).toEqual([
      { message: 'code.second_factor', redacted: true },
      { message: 'code.second_factor', redacted: true },
    ])
  })

  it('drops, never sends late, a code past its expiry, and logs no number or code', async () => {
    const { senders, sent } = fakeSenders()
    const logged = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    await queue(t.partnerA, code('+919845022113', { expiresAt: new Date(now.getTime() - 1000).toISOString() }))
    await relay(accountsOf({ [t.partnerA]: [msg91] }), senders)
    expect(sent).toEqual([])
    const lines = logged.mock.calls.map((c) => String(c[0])).join('\n')
    expect(lines).toContain('"code":"expired"')
    expect(lines).not.toContain('9845022113')
    expect(lines).not.toContain('482913')
    logged.mockRestore()
  })

  it('skips a partner with no account for the number’s country, or no DLT template for the message', async () => {
    const { senders, sent } = fakeSenders()
    await queue(t.partnerB, code('+16145550199'))
    await queue(t.partnerA, code('+919845022113', { message: 'code.verify_phone' }))
    const counts = await relay(accountsOf({ [t.partnerA]: [msg91] }), senders)
    expect(sent).toEqual([])
    expect(counts.delivered).toBe(2)
    expect(await pending()).toBe(0)
  })

  it('retries a provider outage with backoff, and drops a refusal', async () => {
    const { senders, sent, failNext } = fakeSenders()
    await queue(t.partnerA, code('+16145550199'))
    failNext(new SmsUnavailable('answered 503'))
    expect((await relay(accountsOf({ [t.partnerA]: [twilio] }), senders)).retry).toBe(1)
    expect((await relay(accountsOf({ [t.partnerA]: [twilio] }), senders)).delivered).toBe(1)
    expect(sent).toHaveLength(1)
    await queue(t.partnerA, code('+16145550199'))
    failNext(new SmsRefused('twilio_21211'))
    expect((await relay(accountsOf({ [t.partnerA]: [twilio] }), senders)).delivered).toBe(1)
    expect(sent).toHaveLength(1)
  })

  it('keeps no number or code once a text is given up after its last attempt', async () => {
    const { senders, failNext } = fakeSenders()
    const id = await queue(t.partnerA, code('+16145550133'))
    failNext(new SmsUnavailable('answered 503'))
    const counts = await relayDue(db.sql, { sms: smsDeliverer(db.sql, accountsOf({ [t.partnerA]: [twilio] }), senders, () => now) }, { ...defaultRelayOptions, now: () => new Date(now.getTime() + 1000), maxAttempts: 1 })
    expect(counts.dead).toBe(1)
    const [row] = await db.sql<{ payload: unknown; failed_at: Date | null }[]>`select payload, failed_at from outbox where id = ${id ?? ''}`
    expect(row?.failed_at).not.toBeNull()
    expect(row?.payload).toEqual({ message: 'code.second_factor', redacted: true })
  })

  it('gives up and redacts a code past its expiry that no deliverer took', async () => {
    const id = await queue(t.partnerB, code('+16145550144', { expiresAt: new Date(now.getTime() + 60_000).toISOString() }))
    expect(await withSystemScope(db.sql, (tx) => expireUnsentSms(tx, now))).toBe(0)
    expect(await withSystemScope(db.sql, (tx) => expireUnsentSms(tx, new Date(now.getTime() + 61_000)))).toBeGreaterThanOrEqual(1)
    const [row] = await db.sql<{ payload: unknown; last_error: string }[]>`select payload, last_error from outbox where id = ${id ?? ''}`
    expect(row).toEqual({ payload: { message: 'code.second_factor', redacted: true }, last_error: 'expired' })
  })

  it('refuses to queue a text that isn’t one of its messages', async () => {
    await expect(queue(t.partnerA, { ...code('+16145550199'), vars: { code: 'hello' } })).rejects.toThrow()
    await expect(queue(t.partnerA, { ...code('not-a-number') })).rejects.toThrow()
  })

  it('texts once for one idempotency key, however often the request is retried', async () => {
    const key = `sms:${crypto.randomUUID()}`
    const first = await withSystemScope(db.sql, (tx) => queueSms(tx, { partnerId: t.partnerA, storeId: null, idempotencyKey: key, payload: code('+16145550199') }))
    const again = await withSystemScope(db.sql, (tx) => queueSms(tx, { partnerId: t.partnerA, storeId: null, idempotencyKey: key, payload: code('+16145550199') }))
    expect(first).not.toBeNull()
    expect(again).toBeNull()
  })
})
