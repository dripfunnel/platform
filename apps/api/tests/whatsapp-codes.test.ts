import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { SmsRefused } from '#core/sms'
import type { OutgoingWhatsApp } from '#core/whatsapp'
import { withSystemScope } from '#db/scoped/index'
import { whatsappDeliverer } from '#jobs/queues/deliverers/whatsapp'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { queueSideEffect } from '#saas/outbox/index'
import { expireUnsentWhatsAppCodes, queueWhatsAppCode, type PartnerWhatsAppAccount, type PartnerWhatsAppAccounts } from '#saas/whatsapp/index'
import { createTestDatabase, type TestDatabase } from './support/database'
import { seedTenants, type Tenants } from './support/fixtures'

// Card #1506: a portal code by the partner's WhatsApp, as Meta's authentication template `code.portal`, through the outbox.

let db: TestDatabase
let t: Tenants
let now: Date

const dbNow = async (): Promise<Date> => {
  const [row] = await db.sql<{ now: Date }[]>`select now() as now`
  if (!row) throw new Error('the test database gave no clock')
  return row.now
}

beforeAll(async () => {
  db = await createTestDatabase()
  now = await dbNow()
  t = await seedTenants(db.sql)
}, 60_000)

afterAll(async () => {
  await db?.drop()
})

const account = (templates: PartnerWhatsAppAccount['templates']): PartnerWhatsAppAccount => ({ accessToken: 'token', businessAccountId: '10001', phoneNumberId: '20002', language: 'en_US', templates })
const accountsOf = (byPartner: Record<string, PartnerWhatsAppAccount>): PartnerWhatsAppAccounts => ({ forPartner: async (_tx, partnerId) => byPartner[partnerId] ?? null })

const queueCode = (partnerId: string, to: string, expiresAt = new Date(now.getTime() + 600_000)) =>
  withSystemScope(db.sql, (tx) => queueWhatsAppCode(tx, { partnerId, idempotencyKey: `code:${crypto.randomUUID()}`, payload: { message: 'code.portal', to, code: '482913', expiresAt: expiresAt.toISOString() } }))

const relay = async (accounts: PartnerWhatsAppAccounts, send: (m: OutgoingWhatsApp) => Promise<void>) => {
  const at = new Date((await dbNow()).getTime() + 1000)
  const sender = () => ({ send: async (m: OutgoingWhatsApp) => (await send(m), { providerId: 'wamid' }) })
  return relayDue(db.sql, { whatsapp: whatsappDeliverer(db.sql, accounts, sender, 'suppression-key', 'shop.example', () => at) }, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })
}

const rowOf = async (id: string | null) =>
  (await db.sql<{ payload: unknown; delivered_at: Date | null; last_error: string | null }[]>`select payload, delivered_at, last_error from outbox where id = ${id ?? ''}`)[0]

describe('portal codes by WhatsApp', () => {
  it('sends the code as the partner’s code.portal template, its body and Copy code button, then keeps only the message kind', async () => {
    const sent: OutgoingWhatsApp[] = []
    const id = await queueCode(t.partnerA, '+919845022113')
    await relay(accountsOf({ [t.partnerA]: account({ 'code.portal': 'northstar_code' }) }), async (m) => void sent.push(m))
    expect(sent).toEqual([{ to: '+919845022113', template: 'northstar_code', language: 'en_US', vars: ['482913'], copyCode: '482913' }])
    const row = await rowOf(id)
    expect(row?.delivered_at).not.toBeNull()
    expect(row?.payload).toEqual({ message: 'code.portal', redacted: true })
  })

  it('never sends a code late, without the partner’s account or its template, or after Meta refuses it, and redacts each', async () => {
    const sent: OutgoingWhatsApp[] = []
    const late = await queueCode(t.partnerA, '+919845022114', new Date(now.getTime() - 1000))
    await relay(accountsOf({ [t.partnerA]: account({ 'code.portal': 'northstar_code' }) }), async (m) => void sent.push(m))
    const noAccount = await queueCode(t.partnerB, '+919845022115')
    const noTemplate = await queueCode(t.partnerA, '+919845022116')
    await relay(accountsOf({ [t.partnerA]: account({ 'cart.reminder': 'cart' }) }), async (m) => void sent.push(m))
    const refused = await queueCode(t.partnerA, '+919845022117')
    await relay(accountsOf({ [t.partnerA]: account({ 'code.portal': 'northstar_code' }) }), async () => {
      throw new SmsRefused('131026')
    })
    expect(sent).toEqual([])
    for (const [id, error] of [[late, 'expired'], [noAccount, 'no_account'], [noTemplate, 'no_template'], [refused, '131026']] as const) {
      const row = await rowOf(id)
      expect(row?.last_error, error).toBe(error)
      expect(row?.payload).toEqual({ message: 'code.portal', redacted: true })
    }
  })

  it('sweeps a code nobody sent before it expired, and leaves a cart reminder, which has no expiry', async () => {
    const code = await queueCode(t.partnerB, '+16145550160', new Date(now.getTime() + 60_000))
    const reminder = await withSystemScope(db.sql, (tx) =>
      queueSideEffect(tx, { kind: 'whatsapp', idempotencyKey: `reminder:${crypto.randomUUID()}`, payload: { reminderId: crypto.randomUUID(), currency: 'INR', lines: [] }, partnerId: t.partnerB, storeId: t.storeB1 }),
    )
    await db.sql`update outbox set created_at = ${new Date(now.getTime() - 30 * 24 * 3_600_000)} where id = ${reminder ?? ''}`
    const sweep = (at: Date) => withSystemScope(db.sql, (tx) => expireUnsentWhatsAppCodes(tx, at, defaultRelayOptions.leaseMs))
    expect(await sweep(now)).toBe(0)
    expect(await sweep(new Date(now.getTime() + 61_000))).toBe(1)
    expect(await rowOf(code)).toMatchObject({ payload: { message: 'code.portal', redacted: true }, last_error: 'expired' })
    expect((await rowOf(reminder))?.last_error).toBeNull()
  })
})
