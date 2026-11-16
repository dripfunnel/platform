import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { smsMessages, type OutgoingSms, type SmsAccountCheck } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import { smsDeliverer, type SmsSenders } from '#jobs/queues/deliverers/sms'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createPartnerSmsService } from '#saas/partnerCredentials/index'
import { queueSms, smsAccountsFor, type OurSmsAccounts, type PartnerSmsAccount, type SmsPayload } from '#saas/sms/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #1017: DripFunnel's MSG91 and Twilio send by default, a partner's own complete account replaces ours per provider,
// and the partner's SMS switch stops every text.

let db: TestDatabase
let box: SecretBox
const now = new Date('2026-11-16T09:00:00Z')
const ids = { ns: '', kl: '', fresh: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const kek = Buffer.alloc(32, 9).toString('base64')

const msg91Key = '412345AbCdEfGhIjKlMnOpQr'
const twilioToken = 'f'.repeat(28) + '9a8b'
const accountSid = `AC${'1'.repeat(32)}`
const serviceSid = `MG${'2'.repeat(32)}`
const templates = smsMessages.map((message, i) => ({ message, templateId: `65a0${i}c0ffee` }))

let verdict: SmsAccountCheck = 'ok'
const checked: PartnerSmsAccount[] = []

const callerOf = (partnerId: string, role: PartnerRole, staff = false, impersonating = false): PartnerCaller => ({
  role,
  user: staff ? null : { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: staff || impersonating ? { id: crypto.randomUUID(), name: 'Priya Shah', email: 'priya@dripfunnel.example', session: { kind: impersonating ? 'impersonation' : 'setup', id: crypto.randomUUID(), expiresAt: new Date('2026-11-16T11:00:00Z') } } : null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const sms = createPartnerSmsService({
    sql: db.sql,
    caller,
    facts,
    activity: activityLog,
    secrets: box,
    checkSms: async (account) => {
      checked.push(account)
      return verdict
    },
    now: () => now,
  })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, sms } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const list = `{ smsAccounts { enabled accounts { provider hint status lastTestedAt templatesComplete } } }`
type Listed = { smsAccounts: { enabled: boolean; accounts: { provider: string; hint: string; status: string; lastTestedAt: string | null; templatesComplete: boolean | null }[] } }
const save = `mutation($provider: String!, $authKey: String, $templates: [PartnerSmsTemplateInput!], $accountSid: String, $authToken: String, $messagingServiceSid: String) {
  saveSmsAccount(provider: $provider, authKey: $authKey, templates: $templates, accountSid: $accountSid, authToken: $authToken, messagingServiceSid: $messagingServiceSid) { ok reason status } }`
type Saved = { saveSmsAccount: { ok: boolean; reason: string | null; status: string | null } }
const test = `mutation($provider: String!) { testSmsAccount(provider: $provider) { ok reason status } }`
const remove = `mutation($provider: String!) { removeSmsAccount(provider: $provider) { ok reason } }`
const setEnabled = `mutation($enabled: Boolean!) { setSmsEnabled(enabled: $enabled) { ok reason } }`
const msg91Input = { provider: 'msg91', authKey: msg91Key, templates }
const twilioInput = { provider: 'twilio', accountSid, authToken: twilioToken, messagingServiceSid: serviceSid }

beforeAll(async () => {
  db = await createTestDatabase()
  box = await secretBox(kek)
  await seed(db.url, now)
  for (const [key, name] of [['ns', 'Northstar Commerce'], ['kl', 'Kaufladen Digital']] as const) {
    ids[key] = (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  }
  ids.fresh = (await db.sql<{ id: string }[]>`insert into partner (name, state) values ('SMS fresh', 'live') returning id`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db.drop()
})

describe('the partner’s SMS accounts', () => {
  it('starts with SMS on and no account of its own', async () => {
    expect((await run<Listed>(list, callerOf(ids.ns, 'partner-owner'))).data?.smsAccounts).toEqual({ enabled: true, accounts: [] })
  })

  it('checks and seals each account, and shows back only the provider, its last four and whether it is complete', async () => {
    checked.length = 0
    expect((await run<Saved>(save, callerOf(ids.ns, 'partner-owner'), msg91Input)).data?.saveSmsAccount).toEqual({ ok: true, reason: null, status: 'ok' })
    expect((await run<Saved>(save, callerOf(ids.ns, 'partner-admin'), twilioInput)).data?.saveSmsAccount).toEqual({ ok: true, reason: null, status: 'ok' })
    expect(checked.map((a) => a.provider)).toEqual(['msg91', 'twilio'])
    const shown = await run<Listed>(list, callerOf(ids.ns, 'partner-owner'))
    expect(shown.data?.smsAccounts.accounts).toEqual([
      { provider: 'msg91', hint: '…OpQr', status: 'ok', lastTestedAt: now.toISOString(), templatesComplete: true },
      { provider: 'twilio', hint: '…9a8b', status: 'ok', lastTestedAt: now.toISOString(), templatesComplete: null },
    ])
    const text = JSON.stringify(shown.data)
    expect(text).not.toContain(msg91Key)
    expect(text).not.toContain(twilioToken)
    const stored = await db.sql<{ provider: string; key_enc: string; settings: unknown }[]>`select provider, key_enc, settings from partner_credential where partner_id = ${ids.ns} and kind = 'sms' order by provider`
    expect(stored.map((r) => r.key_enc.startsWith('v1.'))).toEqual([true, true])
    expect(JSON.stringify(stored)).not.toContain(msg91Key)
    expect(JSON.stringify(stored)).not.toContain(twilioToken)
    expect(stored[1]?.settings).toEqual({ accountSid, messagingServiceSid: serviceSid })
  })

  it('replaces the provider’s one account on a second save, never adding another', async () => {
    const otherKey = '499999ZyXwVuTsRqPoNmLk'
    expect((await run<Saved>(save, callerOf(ids.ns, 'partner-owner'), { ...msg91Input, authKey: otherKey })).data?.saveSmsAccount.ok).toBe(true)
    const rows = await db.sql<{ key_prefix: string }[]>`select key_prefix from partner_credential where partner_id = ${ids.ns} and kind = 'sms' and provider = 'msg91'`
    expect(rows).toEqual([{ key_prefix: '…NmLk' }])
    expect((await run<Saved>(save, callerOf(ids.ns, 'partner-owner'), msg91Input)).data?.saveSmsAccount.ok).toBe(true)
  })

  it('refuses an MSG91 account without all seven template ids, a malformed value and a rejected or unreachable account, saving nothing', async () => {
    const caller = callerOf(ids.fresh, 'partner-owner')
    const reason = async (input: Record<string, unknown>) => (await run<Saved>(save, caller, input)).data?.saveSmsAccount.reason
    expect(await reason({ ...msg91Input, templates: templates.slice(1) })).toBe('TEMPLATES_INCOMPLETE')
    expect(await reason({ ...msg91Input, templates: templates.map((t, i) => (i === 3 ? { ...t, templateId: '' } : t)) })).toBe('TEMPLATES_INCOMPLETE')
    expect(await reason({ ...msg91Input, templates: [...templates.slice(1), { message: 'marketing.blast', templateId: 'x1' }] })).toBe('INVALID_INPUT')
    expect(await reason({ ...msg91Input, authKey: 'short' })).toBe('INVALID_INPUT')
    expect(await reason({ ...twilioInput, accountSid: 'SK123' })).toBe('INVALID_INPUT')
    expect(await reason({ provider: 'twilio', authKey: msg91Key, templates })).toBe('INVALID_INPUT')
    expect(await reason({ provider: 'vonage', authKey: msg91Key })).toBe('INVALID_INPUT')
    verdict = 'rejected'
    expect(await reason(twilioInput)).toBe('KEY_REJECTED')
    verdict = 'unavailable'
    expect(await reason(twilioInput)).toBe('PROVIDER_UNAVAILABLE')
    verdict = 'ok'
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.fresh}`).length).toBe(0)
  })

  it('tests a stored account with one check and records the answer', async () => {
    checked.length = 0
    verdict = 'rejected'
    expect((await run<{ testSmsAccount: unknown }>(test, callerOf(ids.ns, 'partner-owner'), { provider: 'twilio' })).data?.testSmsAccount).toEqual({ ok: true, reason: null, status: 'rejected' })
    verdict = 'ok'
    expect(checked).toEqual([{ provider: 'twilio', accountSid, authToken: twilioToken, messagingServiceSid: serviceSid }])
    expect((await run<Listed>(list, callerOf(ids.ns, 'partner-owner'))).data?.smsAccounts.accounts.find((a) => a.provider === 'twilio')?.status).toBe('rejected')
    expect((await run<{ testSmsAccount: unknown }>(test, callerOf(ids.ns, 'partner-owner'), { provider: 'twilio' })).data?.testSmsAccount).toEqual({ ok: true, reason: null, status: 'ok' })
    expect((await run<{ testSmsAccount: unknown }>(test, callerOf(ids.fresh, 'partner-owner'), { provider: 'msg91' })).data?.testSmsAccount).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
  })

  it('turns SMS off and on, recording only a change', async () => {
    expect((await run<{ setSmsEnabled: unknown }>(setEnabled, callerOf(ids.ns, 'partner-admin'), { enabled: false })).data?.setSmsEnabled).toEqual({ ok: true, reason: null })
    expect((await run<Listed>(list, callerOf(ids.ns, 'partner-owner'))).data?.smsAccounts.enabled).toBe(false)
    await run(setEnabled, callerOf(ids.ns, 'partner-admin'), { enabled: false })
    await run(setEnabled, callerOf(ids.ns, 'partner-owner'), { enabled: true })
    const entries = await db.sql<{ action: string }[]>`select action from activity_log where partner_id = ${ids.ns} and action in ('partner.sms_enabled', 'partner.sms_disabled')`
    expect(entries.map((e) => e.action).sort()).toEqual(['partner.sms_disabled', 'partner.sms_enabled'])
  })

  it('audits every write without a secret', async () => {
    const rows = await db.sql<{ action: string; entry: string }[]>`select action, row_to_json(activity_log)::text as entry from activity_log where partner_id = ${ids.ns} and action like 'partner.sms%'`
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['partner.sms_account_saved', 'partner.sms_account_tested', 'partner.sms_enabled', 'partner.sms_disabled']))
    for (const r of rows) {
      expect(r.entry).not.toContain(msg91Key)
      expect(r.entry).not.toContain(twilioToken)
    }
  })

  it('removes an account, audited', async () => {
    const caller = callerOf(ids.kl, 'partner-owner')
    await run(save, caller, twilioInput)
    expect((await run<{ removeSmsAccount: unknown }>(remove, caller, { provider: 'twilio' })).data?.removeSmsAccount).toEqual({ ok: true, reason: null })
    expect((await run<Listed>(list, caller)).data?.smsAccounts.accounts).toEqual([])
    expect((await run<{ removeSmsAccount: unknown }>(remove, caller, { provider: 'twilio' })).data?.removeSmsAccount).toEqual({ ok: false, reason: 'NOT_FOUND' })
    expect((await db.sql`select 1 from activity_log where partner_id = ${ids.kl} and action = 'partner.sms_account_removed'`).length).toBe(1)
  })
})

describe('who may', () => {
  it('lets Owner, Admin and a setup session manage SMS, and refuses Support, Finance and Read-only every field', async () => {
    for (const [role, staff, ok] of [['partner-owner', false, true], ['partner-admin', false, true], ['partner-owner', true, true], ['partner-support', false, false], ['partner-finance', false, false], ['partner-read-only', false, false]] as const) {
      const caller = callerOf(ids.kl, role, staff)
      const results = [await run(list, caller), await run(save, caller, twilioInput), await run(test, caller, { provider: 'twilio' }), await run(setEnabled, caller, { enabled: true }), await run(remove, caller, { provider: 'twilio' })]
      for (const r of results) expect(r.code, `${role}${staff ? ' setup' : ''}`).toBe(ok ? undefined : 'FORBIDDEN')
    }
  })

  it('refuses every SMS field to an impersonation', async () => {
    const imp = callerOf(ids.ns, 'partner-owner', false, true)
    for (const [source, variables] of [[list, {}], [save, twilioInput], [test, { provider: 'twilio' }], [remove, { provider: 'twilio' }], [setEnabled, { enabled: false }]] as const) {
      expect((await run(source, imp, variables)).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    }
  })
})

describe('isolation between partners', () => {
  it('never shows, tests or removes another partner’s account', async () => {
    const other = callerOf(ids.fresh, 'partner-owner')
    expect((await run<Listed>(list, other)).data?.smsAccounts.accounts).toEqual([])
    expect((await run<{ testSmsAccount: { reason: string } }>(test, other, { provider: 'msg91' })).data?.testSmsAccount.reason).toBe('NOT_FOUND')
    expect((await run<{ removeSmsAccount: { reason: string } }>(remove, other, { provider: 'msg91' })).data?.removeSmsAccount.reason).toBe('NOT_FOUND')
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.ns} and kind = 'sms'`).length).toBe(2)
  })

  it('keeps the sealed secret from every console role', async () => {
    for (const role of ['app_partner', 'app_platform', 'app_request']) {
      await expect(
        db.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`)
          await tx`select key_enc from partner_credential where kind = 'sms'`
        }),
      ).rejects.toThrow(/permission denied/)
    }
  })
})

describe('which account sends', () => {
  const ourMsg91 = { provider: 'msg91', authKey: 'ours-msg91', templates: Object.fromEntries(smsMessages.map((m) => [m, `ours-${m}`])) } as const
  const ours: OurSmsAccounts = { msg91: ourMsg91, twilio: { provider: 'twilio', accountSid: 'AC-ours', authToken: 'ours-token', messagingServiceSid: 'MG-ours' } }
  const resolve = (partnerId: string, provider: 'msg91' | 'twilio', accounts = ours) => withSystemScope(db.sql, (tx) => smsAccountsFor(box, accounts).forPartner(tx, partnerId, provider))

  it('uses the partner’s complete account per provider, and DripFunnel’s where it has none', async () => {
    expect(await resolve(ids.ns, 'msg91')).toMatchObject({ provider: 'msg91', authKey: msg91Key, templates: { 'code.second_factor': '65a00c0ffee' } })
    expect(await resolve(ids.ns, 'twilio')).toEqual({ provider: 'twilio', accountSid, authToken: twilioToken, messagingServiceSid: serviceSid })
    expect(await resolve(ids.fresh, 'msg91')).toBe(ours.msg91)
    expect(await resolve(ids.fresh, 'twilio')).toBe(ours.twilio)
    expect(await resolve(ids.fresh, 'twilio', { msg91: ourMsg91 })).toBeNull()
  })

  it('falls back to DripFunnel’s MSG91 when the partner’s is missing a template, and when its secret can’t be opened', async () => {
    const sealed = await box.seal(msg91Key)
    const partial = { templates: Object.fromEntries(smsMessages.slice(1).map((m) => [m, 'x1'])) }
    await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, created_by) values (${ids.fresh}, 'sms', 'msg91', 'MSG91', ${sealed}, '…OpQr', ${JSON.stringify(partial)}::text::jsonb, 'test')`
    expect(await resolve(ids.fresh, 'msg91')).toBe(ours.msg91)
    await db.sql`update partner_credential set key_enc = 'v1.broken.broken', settings = ${JSON.stringify({ templates: Object.fromEntries(smsMessages.map((m) => [m, 'x1'])) })}::text::jsonb where partner_id = ${ids.fresh} and kind = 'sms'`
    expect(await resolve(ids.fresh, 'msg91')).toBe(ours.msg91)
    await db.sql`delete from partner_credential where partner_id = ${ids.fresh} and kind = 'sms'`
  })

  it('answers off for a partner whose SMS is off, whatever accounts exist', async () => {
    await db.sql`update partner set sms_enabled = false where id = ${ids.fresh}`
    expect(await resolve(ids.fresh, 'twilio')).toBe('off')
    await db.sql`update partner set sms_enabled = true where id = ${ids.fresh}`
  })
})

describe('the sms deliverer with real accounts', () => {
  const ours: OurSmsAccounts = { twilio: { provider: 'twilio', accountSid: 'AC-ours', authToken: 'ours-token', messagingServiceSid: 'MG-ours' }, msg91: { provider: 'msg91', authKey: 'ours-msg91', templates: Object.fromEntries(smsMessages.map((m) => [m, `ours-${m}`])) } }
  const used: string[] = []
  const senders: SmsSenders = {
    msg91: (c) => ({ send: async (sms: OutgoingSms) => (used.push(`msg91:${c.authKey}:${sms.dlt?.templateId ?? ''}`), { providerId: 'm' }) }),
    twilio: (c) => ({ send: async () => (used.push(`twilio:${c.accountSid}`), { providerId: 't' }) }),
  }
  const dbNow = async () => (await db.sql<{ now: Date }[]>`select now() as now`)[0]?.now ?? new Date()
  const code = async (to: string): Promise<SmsPayload> => ({ message: 'code.second_factor', to, brand: 'Northstar', vars: { code: '482913' }, expiresAt: new Date((await dbNow()).getTime() + 600_000).toISOString() })
  const queue = async (partnerId: string, to: string) => withSystemScope(db.sql, async (tx) => queueSms(tx, { partnerId, storeId: null, idempotencyKey: `sms:${crypto.randomUUID()}`, payload: await code(to) }))
  const relay = async () => {
    const at = new Date((await dbNow()).getTime() + 1000)
    return relayDue(db.sql, { sms: smsDeliverer(db.sql, smsAccountsFor(box, ours), senders, () => at) }, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })
  }

  it('sends each partner’s texts through its own account, and the rest through DripFunnel’s', async () => {
    used.length = 0
    await queue(ids.ns, '+919845022180')
    await queue(ids.ns, '+16145550180')
    await queue(ids.fresh, '+919845022181')
    await queue(ids.fresh, '+16145550181')
    expect((await relay()).delivered).toBe(4)
    expect(used.sort()).toEqual([`msg91:${msg91Key}:65a00c0ffee`, `twilio:${accountSid}`, 'msg91:ours-msg91:ours-code.second_factor', 'twilio:AC-ours'].sort())
  })

  it('sends no text for a partner whose SMS is off, through any account, and gives it up as sms_off', async () => {
    used.length = 0
    await db.sql`update partner set sms_enabled = false where id in ${db.sql([ids.ns, ids.fresh])}`
    const mine = await queue(ids.ns, '+16145550182')
    const ourText = await queue(ids.fresh, '+919845022182')
    const counts = await relay()
    expect(used).toEqual([])
    expect(counts.dropped).toBe(2)
    const rows = await db.sql<{ last_error: string; delivered_at: Date | null; payload: unknown }[]>`select last_error, delivered_at, payload from outbox where id in ${db.sql([mine ?? '', ourText ?? ''])}`
    expect(rows.map((r) => [r.last_error, r.delivered_at])).toEqual([['sms_off', null], ['sms_off', null]])
    expect(rows.map((r) => r.payload)).toEqual([{ message: 'code.second_factor', redacted: true }, { message: 'code.second_factor', redacted: true }])
    await db.sql`update partner set sms_enabled = true where id in ${db.sql([ids.ns, ids.fresh])}`
  })
})
