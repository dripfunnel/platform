import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { SmsRefused, SmsUnavailable, type OutgoingSms, type SmsSender } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import { smsDeliverer, type SmsSenders } from '#jobs/queues/deliverers/sms'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { expireUnsentSms, orderTextMs, queueSms, type PartnerSmsAccount, type PartnerSmsAccounts, type SmsPayload } from '#saas/sms/index'
import { queueSideEffect } from '#saas/outbox/index'
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

const sweep = (at: Date) => withSystemScope(db.sql, (tx) => expireUnsentSms(tx, at, defaultRelayOptions.leaseMs))

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
    expect(counts).toMatchObject({ delivered: 0, dropped: 2 })
    expect(await pending()).toBe(0)
    const rows = await db.sql<{ last_error: string; delivered_at: Date | null }[]>`select last_error, delivered_at from outbox where kind = 'sms' and last_error in ('no_twilio_account', 'no_dlt_template')`
    expect(rows.map((r) => r.last_error).sort()).toEqual(['no_dlt_template', 'no_twilio_account'])
    expect(rows.every((r) => r.delivered_at === null)).toBe(true)
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
    expect((await relay(accountsOf({ [t.partnerA]: [twilio] }), senders)).dropped).toBe(1)
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
    expect(await sweep(now)).toBe(0)
    expect(await sweep(new Date(now.getTime() + 61_000))).toBeGreaterThanOrEqual(1)
    const [row] = await db.sql<{ payload: unknown; last_error: string }[]>`select payload, last_error from outbox where id = ${id ?? ''}`
    expect(row).toEqual({ payload: { message: 'code.second_factor', redacted: true }, last_error: 'expired' })
  })

  it('gives up an order update nobody sent within three days, and leaves a row the relay holds', async () => {
    const shipped: SmsPayload = { message: 'order.shipped', to: '+16145550155', brand: 'Northstar', vars: { order: 'NS-1001', courier: 'USPS', link: 'https://shop.example/t/1' }, expiresAt: null }
    const id = await queue(t.partnerB, shipped)
    await db.sql`update outbox set created_at = ${now} where id = ${id ?? ''}`
    expect(await sweep(new Date(now.getTime() + orderTextMs - 1000))).toBe(0)
    await db.sql`update outbox set claimed_at = ${new Date(now.getTime() + orderTextMs)} where id = ${id ?? ''}`
    expect(await sweep(new Date(now.getTime() + orderTextMs + 1000))).toBe(0)
    await db.sql`update outbox set claimed_at = null where id = ${id ?? ''}`
    expect(await sweep(new Date(now.getTime() + orderTextMs + 1000))).toBe(1)
    const [row] = await db.sql<{ payload: unknown }[]>`select payload from outbox where id = ${id ?? ''}`
    expect(row?.payload).toEqual({ message: 'order.shipped', redacted: true })
  })

  it('texts each partner’s people through that partner’s own account and templates only', async () => {
    const used: string[] = []
    const senders: SmsSenders = {
      msg91: (c) => ({ send: async (sms) => (used.push(`msg91:${c.authKey}:${sms.dlt?.templateId ?? ''}`), { providerId: 'm' }) }),
      twilio: (c) => ({ send: async () => (used.push(`twilio:${c.accountSid}`), { providerId: 't' }) }),
    }
    const accounts = accountsOf({
      [t.partnerA]: [msg91, twilio],
      [t.partnerB]: [{ provider: 'msg91', authKey: 'k-b', templates: { 'code.second_factor': 'tmpl-b' } }, { ...twilio, accountSid: 'AC-B' }],
    })
    await queue(t.partnerA, code('+919845022170'))
    await queue(t.partnerB, code('+919845022171'))
    await queue(t.partnerA, code('+16145550170'))
    await queue(t.partnerB, code('+16145550171'))
    await relay(accounts, senders)
    expect(used.sort()).toEqual(['msg91:k-b:tmpl-b', 'msg91:k:tmpl-2fa', 'twilio:AC-B', 'twilio:AC1'].sort())
  })

  it('sends nothing for a row with no partner, whoever has an account', async () => {
    const { senders, sent } = fakeSenders()
    const id = await withSystemScope(db.sql, (tx) => queueSideEffect(tx, { kind: 'sms', partnerId: null, storeId: null, idempotencyKey: `sms:${crypto.randomUUID()}`, payload: code('+16145550172') }))
    await relay(accountsOf({ [t.partnerA]: [twilio], [t.partnerB]: [twilio] }), senders)
    expect(sent).toEqual([])
    const [row] = await db.sql<{ last_error: string }[]>`select last_error from outbox where id = ${id ?? ''}`
    expect(row?.last_error).toBe('bad_payload')
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
