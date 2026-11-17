import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { smsMessages, SmsRefused, SmsUnavailable, type OutgoingSms, type SmsAccountCheck, type SmsMessage, type SmsRoute } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import { snsSender } from '#integrations/sns/index'
import { smsDeliverer, type SmsSenders } from '#jobs/queues/deliverers/sms'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createPartnerSmsService } from '#saas/partnerCredentials/index'
import { codeChannelsFor, queuePortalCode } from '#saas/portalCodes/index'
import { expireUnsentSms, queueSms, smsAccountsFor, smsDeliveryFor, type OurSmsRoutes, type PartnerSmsAccount, type PartnerSmsAccounts, type SmsPayload } from '#saas/sms/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #1017: a partner's own complete account sends its route, DripFunnel's the routes it hasn't set up, and the partner's
// SMS switch stops every text. Since #1543 DripFunnel's are saved in the admin console and used only where Admin enabled
// them for the partner (tests/df-messaging.test.ts); here they are open to every partner unless a test says otherwise.

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
    ourSms: async () => ({}),
    now: () => now,
  })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, sms } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const list = `{ smsAccounts { enabled accounts { provider hint status lastTestedAt templatesComplete } } }`
type Listed = { smsAccounts: { enabled: boolean; accounts: { provider: string; hint: string; status: string; lastTestedAt: string | null; templatesComplete: boolean | null }[] } }
const save = `mutation($provider: String!, $authKey: String, $templates: [PartnerSmsTemplateInput!], $accountSid: String, $authToken: String, $messagingServiceSid: String,
  $accessKeyId: String, $secretAccessKey: String, $region: String, $senderId: String, $entityId: String) {
  saveSmsAccount(provider: $provider, authKey: $authKey, templates: $templates, accountSid: $accountSid, authToken: $authToken, messagingServiceSid: $messagingServiceSid,
    accessKeyId: $accessKeyId, secretAccessKey: $secretAccessKey, region: $region, senderId: $senderId, entityId: $entityId) { ok reason status } }`
type Saved = { saveSmsAccount: { ok: boolean; reason: string | null; status: string | null } }
const test = `mutation($provider: String!) { testSmsAccount(provider: $provider) { ok reason status } }`
const remove = `mutation($provider: String!) { removeSmsAccount(provider: $provider) { ok reason } }`
const setEnabled = `mutation($enabled: Boolean!) { setSmsEnabled(enabled: $enabled) { ok reason } }`
const setRoute = `mutation($route: String!, $provider: String) { setSmsRoute(route: $route, provider: $provider) { ok reason } }`
type Routed = { setSmsRoute: { ok: boolean; reason: string | null } }
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
      const results = [await run(list, caller), await run(save, caller, twilioInput), await run(test, caller, { provider: 'twilio' }), await run(setEnabled, caller, { enabled: true }), await run(setRoute, caller, { route: 'rest', provider: null }), await run(remove, caller, { provider: 'twilio' })]
      for (const r of results) expect(r.code, `${role}${staff ? ' setup' : ''}`).toBe(ok ? undefined : 'FORBIDDEN')
    }
  })

  it('refuses every SMS field to an impersonation', async () => {
    const imp = callerOf(ids.ns, 'partner-owner', false, true)
    for (const [source, variables] of [[list, {}], [save, twilioInput], [test, { provider: 'twilio' }], [remove, { provider: 'twilio' }], [setEnabled, { enabled: false }], [setRoute, { route: 'rest', provider: 'twilio' }]] as const) {
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

const snsSecret = 'wJalrXUtnFEMIK7MDENGbPxRfiCYEXAMPLEK3y9Z'
const snsInput = { provider: 'sns', accessKeyId: 'AKIAKLAUFLADEN000001', secretAccessKey: snsSecret, region: 'ap-south-1', senderId: 'KAUFLD', entityId: '1101234567890123456', templates: smsMessages.map((message, i) => ({ message, templateId: `110716${i}` })) }

describe('an SNS account and the partner’s routes', () => {
  it('saves an SNS account with India’s DLT part, sealed, shown back as its last four', async () => {
    const caller = callerOf(ids.kl, 'partner-owner')
    expect((await run<Saved>(save, caller, snsInput)).data?.saveSmsAccount).toEqual({ ok: true, reason: null, status: 'ok' })
    expect((await run<Listed>(list, caller)).data?.smsAccounts.accounts).toEqual([{ provider: 'sns', hint: '…3y9Z', status: 'ok', lastTestedAt: now.toISOString(), templatesComplete: true }])
    const [row] = await db.sql<{ key_enc: string; settings: unknown }[]>`select key_enc, settings from partner_credential where partner_id = ${ids.kl} and provider = 'sns'`
    expect(JSON.stringify(row)).not.toContain(snsSecret)
    expect(row?.settings).toMatchObject({ accessKeyId: 'AKIAKLAUFLADEN000001', region: 'ap-south-1', india: { senderId: 'KAUFLD', entityId: '1101234567890123456' } })
  })

  it('takes an SNS account without India’s part for the rest of the world, and refuses half of it', async () => {
    const caller = callerOf(ids.fresh, 'partner-owner')
    const reason = async (input: Record<string, unknown>) => (await run<Saved>(save, caller, input)).data?.saveSmsAccount.reason
    expect(await reason({ ...snsInput, templates: snsInput.templates.slice(1) })).toBe('TEMPLATES_INCOMPLETE')
    expect(await reason({ provider: 'sns', accessKeyId: snsInput.accessKeyId, secretAccessKey: snsSecret, region: 'ap-south-1', senderId: 'KAUFLD' })).toBe('TEMPLATES_INCOMPLETE')
    expect(await reason({ ...snsInput, entityId: undefined })).toBe('INVALID_INPUT')
    expect(await reason({ ...snsInput, region: 'mumbai' })).toBe('INVALID_INPUT')
    expect(await reason({ ...snsInput, secretAccessKey: 'short' })).toBe('INVALID_INPUT')
    const restOnly = { provider: 'sns', accessKeyId: snsInput.accessKeyId, secretAccessKey: snsSecret, region: 'us-east-1' }
    expect((await run<Saved>(save, caller, restOnly)).data?.saveSmsAccount.ok).toBe(true)
    expect((await run<Listed>(list, caller)).data?.smsAccounts.accounts[0]?.templatesComplete).toBe(false)
    expect((await run<Routed>(setRoute, caller, { route: 'india', provider: 'sns' })).data?.setSmsRoute.reason).toBe('ACCOUNT_INCOMPLETE')
    await run(remove, caller, { provider: 'sns' })
  })

  it('sets a route only to a saved account that serves it, and records the change', async () => {
    const caller = callerOf(ids.kl, 'partner-owner')
    expect((await run<Routed>(setRoute, caller, { route: 'india', provider: 'twilio' })).data?.setSmsRoute.reason).toBe('INVALID_INPUT')
    expect((await run<Routed>(setRoute, caller, { route: 'moon', provider: 'sns' })).data?.setSmsRoute.reason).toBe('INVALID_INPUT')
    expect((await run<Routed>(setRoute, caller, { route: 'india', provider: 'msg91' })).data?.setSmsRoute.reason).toBe('ACCOUNT_INCOMPLETE')
    expect((await run<Routed>(setRoute, caller, { route: 'india', provider: 'sns' })).data?.setSmsRoute).toEqual({ ok: true, reason: null })
    const routes = await run<{ smsAccounts: { routes: { route: string; provider: string | null }[] } }>(`{ smsAccounts { routes { route provider } } }`, caller)
    expect(routes.data?.smsAccounts.routes).toEqual([{ route: 'india', provider: 'sns' }, { route: 'rest', provider: null }])
    expect((await db.sql`select 1 from activity_log where partner_id = ${ids.kl} and action = 'partner.sms_route_set'`).length).toBe(1)
  })
})

describe('which account sends', () => {
  const ourMsg91 = { provider: 'msg91', authKey: 'ours-msg91', templates: Object.fromEntries(smsMessages.map((m) => [m, `ours-${m}`])) } as const
  const ours: OurSmsRoutes = { india: ourMsg91, rest: { provider: 'twilio', accountSid: 'AC-ours', authToken: 'ours-token', messagingServiceSid: 'MG-ours' } }
  const resolve = (partnerId: string, route: SmsRoute, accounts = ours) => withSystemScope(db.sql, (tx) => smsAccountsFor(box, async () => accounts).forPartner(tx, partnerId, route))

  it('uses the partner’s complete account per route, and DripFunnel’s where it has none', async () => {
    expect(await resolve(ids.ns, 'india')).toMatchObject({ provider: 'msg91', authKey: msg91Key, templates: { 'code.second_factor': '65a00c0ffee' } })
    expect(await resolve(ids.ns, 'rest')).toEqual({ provider: 'twilio', accountSid, authToken: twilioToken, messagingServiceSid: serviceSid })
    expect(await resolve(ids.fresh, 'india')).toBe(ours.india)
    expect(await resolve(ids.fresh, 'rest')).toBe(ours.rest)
    expect(await resolve(ids.fresh, 'rest', { india: ourMsg91 })).toBeNull()
  })

  it('sends both routes through a partner’s only account, SNS, and never through another partner’s', async () => {
    expect(await resolve(ids.kl, 'india')).toMatchObject({ provider: 'sns', accessKeyId: 'AKIAKLAUFLADEN000001', secretAccessKey: snsSecret, india: { senderId: 'KAUFLD' } })
    expect(await resolve(ids.kl, 'rest')).toMatchObject({ provider: 'sns', accessKeyId: 'AKIAKLAUFLADEN000001' })
    expect(await resolve(ids.ns, 'rest')).toMatchObject({ provider: 'twilio' })
  })

  it('sends through another of its own accounts that serves the route, never DripFunnel’s, when the partner’s chosen provider is gone (#1543)', async () => {
    await db.sql`update partner set sms_route_india = 'sns' where id = ${ids.ns}`
    expect(await resolve(ids.ns, 'india')).toMatchObject({ provider: 'msg91', authKey: msg91Key })
    await db.sql`update partner set sms_route_india = null where id = ${ids.ns}`
  })

  it('uses DripFunnel’s where the partner’s MSG91 is missing a template, and nothing where its secret can’t be opened (#1543)', async () => {
    const sealed = await box.seal(msg91Key)
    const partial = { templates: Object.fromEntries(smsMessages.slice(1).map((m) => [m, 'x1'])) }
    await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, created_by) values (${ids.fresh}, 'sms', 'msg91', 'MSG91', ${sealed}, '…OpQr', ${JSON.stringify(partial)}::text::jsonb, 'test')`
    expect(await resolve(ids.fresh, 'india')).toBe(ours.india)
    // An account of its own for the route that fails is never handed over to DripFunnel's: no fallback between accounts.
    await db.sql`update partner_credential set key_enc = 'v1.broken.broken', settings = ${JSON.stringify({ templates: Object.fromEntries(smsMessages.map((m) => [m, 'x1'])) })}::text::jsonb where partner_id = ${ids.fresh} and kind = 'sms'`
    expect(await resolve(ids.fresh, 'india')).toBeNull()
    await db.sql`delete from partner_credential where partner_id = ${ids.fresh} and kind = 'sms'`
  })

  it('answers off for a partner whose SMS is off, whatever accounts exist', async () => {
    await db.sql`update partner set sms_enabled = false where id = ${ids.fresh}`
    expect(await resolve(ids.fresh, 'rest')).toBe('off')
    await db.sql`update partner set sms_enabled = true where id = ${ids.fresh}`
  })
})

// DripFunnel's accounts as a Super admin saves them (#1543): sealed rows in `platform_credential`, and its route choice.
const saveOurs = async (routes: { india?: string | null; rest?: string | null } = {}) => {
  await db.sql`delete from platform_credential where kind = 'sms'`
  const rows = [
    ['msg91', '400000OursOursOursOurs', { templates: Object.fromEntries(smsMessages.map((m) => [m, `ours-${m.replace('.', '_')}`])) }],
    ['twilio', '0'.repeat(32), { accountSid: `AC${'0'.repeat(32)}`, messagingServiceSid: `MG${'0'.repeat(32)}` }],
    ['sns', 'o'.repeat(40), { accessKeyId: 'AKIADRIPFUNNEL000001', region: 'ap-south-1', india: { senderId: 'DRPFNL', entityId: '1109999999999999999', templates: Object.fromEntries(smsMessages.map((m, i) => [m, `999${i}`])) } }],
  ] as const
  for (const [provider, secret, settings] of rows) {
    await db.sql`insert into platform_credential (kind, provider, key_enc, key_prefix, settings, status, created_by) values ('sms', ${provider}, ${await box.seal(secret)}, ${`…${secret.slice(-4)}`}, ${JSON.stringify(settings)}::text::jsonb, 'ok', 'test')`
  }
  await db.sql`update platform_messaging set sms_route_india = ${routes.india ?? null}, sms_route_rest = ${routes.rest ?? null}`
}

describe('the sms deliverer with real accounts', () => {
  const used: string[] = []
  // SNS itself is mocked at the network: the real adapter signs and sends, and the request is read back.
  const snsFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const request = new Request(input, init)
    const form = new URLSearchParams(await request.text())
    const attrs = [...form.entries()].filter(([k]) => k.endsWith('.StringValue')).map(([, v]) => v)
    const key = /Credential=([A-Z0-9]+)\//.exec(request.headers.get('authorization') ?? '')?.[1]
    used.push(`sns:${key}:${form.get('PhoneNumber')?.slice(0, 3)}:${attrs.join('|')}`)
    return new Response('<PublishResponse><PublishResult><MessageId>m-1</MessageId></PublishResult></PublishResponse>', { status: 200 })
  }) as typeof fetch
  const senders: SmsSenders = {
    msg91: (c) => ({ send: async (sms: OutgoingSms) => (used.push(`msg91:${c.authKey}:${sms.dlt?.templateId ?? ''}`), { providerId: 'm' }) }),
    twilio: (c) => ({ send: async () => (used.push(`twilio:${c.accountSid}`), { providerId: 't' }) }),
    sns: (c) => snsSender({ ...c, fetchImpl: snsFetch }),
  }
  const dbNow = async () => (await db.sql<{ now: Date }[]>`select now() as now`)[0]?.now ?? new Date()
  const code = async (to: string): Promise<SmsPayload> => ({ message: 'code.second_factor', to, brand: 'Northstar', vars: { code: '482913' }, expiresAt: new Date((await dbNow()).getTime() + 600_000).toISOString() })
  const queue = async (partnerId: string, to: string) => withSystemScope(db.sql, async (tx) => queueSms(tx, { partnerId, storeId: null, idempotencyKey: `sms:${crypto.randomUUID()}`, payload: await code(to) }))
  const relay = async () => {
    const at = new Date((await dbNow()).getTime() + 1000)
    const accounts = smsDeliveryFor(box)
    if (!accounts) throw new Error('no sms deliverer')
    return relayDue(db.sql, { sms: smsDeliverer(db.sql, accounts, senders, () => at) }, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })
  }

  beforeAll(async () => {
    await db.sql`update partner set df_sms_enabled = true where id in ${db.sql([ids.ns, ids.kl, ids.fresh])}`
  })

  afterAll(async () => {
    await db.sql`update partner set df_sms_enabled = false`
    await db.sql`delete from platform_credential`
    await db.sql`update platform_messaging set sms_route_india = null, sms_route_rest = null`
  })

  it('sends each partner’s texts through its own account, and the rest through DripFunnel’s default routes', async () => {
    used.length = 0
    await queue(ids.ns, '+919845022180')
    await queue(ids.ns, '+16145550180')
    await queue(ids.fresh, '+919845022181')
    await queue(ids.fresh, '+16145550181')
    await saveOurs()
    expect((await relay()).delivered).toBe(4)
    expect(used.sort()).toEqual([`msg91:${msg91Key}:65a00c0ffee`, `twilio:${accountSid}`, 'msg91:400000OursOursOursOurs:ours-code_second_factor', `twilio:AC${'0'.repeat(32)}`].sort())
  })

  it('sends a +91 code and a US one through DripFunnel’s SNS when both routes are set to sns, India with its DLT header, entity and template', async () => {
    used.length = 0
    await queue(ids.fresh, '+919845022183')
    await queue(ids.fresh, '+16145550183')
    await saveOurs({ india: 'sns', rest: 'sns' })
    expect((await relay()).delivered).toBe(2)
    expect(used.sort()).toEqual(['sns:AKIADRIPFUNNEL000001:+16:Transactional', 'sns:AKIADRIPFUNNEL000001:+91:Transactional|DRPFNL|1109999999999999999|9990'].sort())
  })

  it('sends a partner’s +91 and US codes through its own SNS, and never another partner’s through it', async () => {
    used.length = 0
    await queue(ids.kl, '+919845022184')
    await queue(ids.kl, '+16145550184')
    await queue(ids.fresh, '+16145550185')
    await saveOurs({ rest: 'sns' })
    expect((await relay()).delivered).toBe(3)
    expect(used.sort()).toEqual(['sns:AKIADRIPFUNNEL000001:+16:Transactional', 'sns:AKIAKLAUFLADEN000001:+16:Transactional', 'sns:AKIAKLAUFLADEN000001:+91:Transactional|KAUFLD|1101234567890123456|1107160'].sort())
  })

  it('sends no text for a partner whose SMS is off, through any account, and gives it up as sms_off', async () => {
    used.length = 0
    await db.sql`update partner set sms_enabled = false where id in ${db.sql([ids.ns, ids.fresh])}`
    const mine = await queue(ids.ns, '+16145550182')
    const ourText = await queue(ids.fresh, '+919845022182')
    await saveOurs()
    const counts = await relay()
    expect(used).toEqual([])
    expect(counts.dropped).toBe(2)
    const rows = await db.sql<{ last_error: string; delivered_at: Date | null; payload: unknown }[]>`select last_error, delivered_at, payload from outbox where id in ${db.sql([mine ?? '', ourText ?? ''])}`
    expect(rows.map((r) => [r.last_error, r.delivered_at])).toEqual([['sms_off', null], ['sms_off', null]])
    expect(rows.map((r) => r.payload)).toEqual([{ message: 'code.second_factor', redacted: true }, { message: 'code.second_factor', redacted: true }])
    await db.sql`update partner set sms_enabled = true where id in ${db.sql([ids.ns, ids.fresh])}`
  })
})

describe('a partner’s own account with no DripFunnel SMS (#1542)', () => {
  const sidA = `AC${'a'.repeat(32)}`
  const sidB = `AC${'b'.repeat(32)}`
  const sidOurs = `AC${'0'.repeat(32)}`
  const own = { a: '', b: '', none: '' }
  const used: string[] = []
  let refuse: string | null = null
  let outage: string | null = null
  const senders: SmsSenders = {
    msg91: () => ({ send: async () => ({ providerId: 'm' }) }),
    twilio: (c) => ({
      send: async (sms: OutgoingSms) => {
        if (c.accountSid === refuse) throw new SmsRefused('twilio_21610')
        if (c.accountSid === outage) throw new SmsUnavailable('answered 503')
        used.push(`twilio:${c.accountSid}:${sms.text.split(':')[0] ?? ''}`)
        return { providerId: 't' }
      },
    }),
    sns: () => ({ send: async () => ({ providerId: 's' }) }),
  }
  const ourRest: OurSmsRoutes = { rest: { provider: 'twilio', accountSid: sidOurs, authToken: '0'.repeat(32), messagingServiceSid: `MG${'0'.repeat(32)}` } }
  const withOurRest = () => smsAccountsFor(box, async () => ourRest)
  const dbNow = async () => (await db.sql<{ now: Date }[]>`select now() as now`)[0]?.now ?? new Date()
  const queue = (partnerId: string, payload: SmsPayload) => withSystemScope(db.sql, (tx) => queueSms(tx, { partnerId, storeId: null, idempotencyKey: `sms:${crypto.randomUUID()}`, payload }))
  const order = (brand: string, to: string): SmsPayload => ({ message: 'order.confirmed', to, brand, vars: { order: 'X-1' }, expiresAt: null })
  const relay = async (accounts: PartnerSmsAccounts | null) => {
    if (!accounts) throw new Error('no sms deliverer')
    const at = new Date((await dbNow()).getTime() + 1000)
    return relayDue(db.sql, { sms: smsDeliverer(db.sql, accounts, senders, () => at) }, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })
  }
  const lastError = async (id: string | null) => (await db.sql<{ last_error: string | null }[]>`select last_error from outbox where id = ${id ?? ''}`)[0]?.last_error
  const pending = async () => (await db.sql<{ n: number }[]>`select count(*)::int as n from outbox where kind = 'sms' and delivered_at is null and failed_at is null`)[0]?.n
  const smsOpen = async (accounts: PartnerSmsAccounts | null, partnerId: string, phone: string | null) => (await withSystemScope(db.sql, (tx) => codeChannelsFor(accounts, async () => false).forPartner(tx, partnerId, phone))).sms

  beforeAll(async () => {
    for (const key of ['a', 'b', 'none'] as const) own[key] = (await db.sql<{ id: string }[]>`insert into partner (name, state) values (${`SMS own ${key}`}, 'live') returning id`)[0]?.id ?? ''
    verdict = 'ok'
    for (const [key, sid] of [['a', sidA], ['b', sidB]] as const) {
      expect((await run<Saved>(save, callerOf(own[key], 'partner-owner'), { ...twilioInput, accountSid: sid })).data?.saveSmsAccount.ok).toBe(true)
    }
  })

  it('shows SMS open on the partner’s own route with no DripFunnel account, and closed where neither has one', async () => {
    const accounts = smsDeliveryFor(box)
    expect(await smsOpen(accounts, own.a, '+16145550190')).toBe(true)
    expect(await smsOpen(accounts, own.a, null)).toBe(true)
    expect(await smsOpen(accounts, own.a, '+919845022190')).toBe(false)
    expect(await smsOpen(accounts, own.none, '+16145550190')).toBe(false)
    expect(await smsOpen(accounts, own.none, null)).toBe(false)
  })

  it('sends a partner’s portal code, order update and rider invite through its own account with no DripFunnel account', async () => {
    used.length = 0
    const expiresAt = new Date((await dbNow()).getTime() + 600_000)
    await withSystemScope(db.sql, (tx) => queuePortalCode(tx, { partnerId: own.a, channel: 'sms', to: '+16145550191', purpose: 'sign_in', code: '482913', expiresAt, brand: async () => 'Own A', idempotencyKey: `code:${crypto.randomUUID()}` }))
    await queue(own.a, { message: 'order.shipped', to: '+16145550192', brand: 'Own A', vars: { order: 'OA-1', courier: 'USPS', link: 'https://shop.example/t/1' }, expiresAt: null })
    await queue(own.a, { message: 'rider.invited', to: '+16145550193', brand: 'Own A', vars: { link: 'https://shop.example/rider' }, expiresAt: null })
    expect((await relay(smsDeliveryFor(box))).delivered).toBe(3)
    expect(used).toEqual([`twilio:${sidA}:Own A`, `twilio:${sidA}:Own A`, `twilio:${sidA}:Own A`])
  })

  it('sends each partner’s texts through its own account only, and gives up one with no account rather than keep it', async () => {
    used.length = 0
    await queue(own.a, order('Own A', '+16145550194'))
    await queue(own.b, order('Own B', '+16145550195'))
    const orphan = await queue(own.none, order('None', '+16145550196'))
    expect(await relay(smsDeliveryFor(box))).toMatchObject({ delivered: 2, dropped: 1 })
    expect(used.sort()).toEqual([`twilio:${sidA}:Own A`, `twilio:${sidB}:Own B`])
    expect(await lastError(orphan)).toBe('no_rest_account')
    expect(await pending()).toBe(0)
  })

  it('has no deliverer and SMS closed with neither credentials nor a DripFunnel account, and the sweep gives up what waits', async () => {
    expect(smsDeliveryFor(null)).toBeNull()
    expect(await smsOpen(smsDeliveryFor(null), own.a, '+16145550197')).toBe(false)
    const at = await dbNow()
    const waiting = await queue(own.none, { message: 'code.second_factor', to: '+16145550197', brand: 'None', vars: { code: '482913' }, expiresAt: new Date(at.getTime() + 60_000).toISOString() })
    await withSystemScope(db.sql, (tx) => expireUnsentSms(tx, new Date(at.getTime() + 61_000), defaultRelayOptions.leaseMs))
    expect(await lastError(waiting)).toBe('expired')
  })

  it('never lets a refused or failing DripFunnel send hold up a partner’s own text, nor the reverse, and never switches account', async () => {
    used.length = 0
    refuse = sidOurs
    const oursRefused = await queue(own.none, order('None', '+16145550198'))
    await queue(own.a, order('Own A', '+16145550198'))
    expect(await relay(withOurRest())).toMatchObject({ delivered: 1, dropped: 1 })
    expect(await lastError(oursRefused)).toBe('twilio_21610')
    refuse = null
    outage = sidOurs
    await queue(own.none, order('None', '+16145550199'))
    await queue(own.a, order('Own A', '+16145550199'))
    expect(await relay(withOurRest())).toMatchObject({ delivered: 1, retry: 1 })
    outage = null
    expect((await relay(withOurRest())).delivered).toBe(1)
    refuse = sidA
    const mineRefused = await queue(own.a, order('Own A', '+16145550189'))
    await queue(own.none, order('None', '+16145550189'))
    expect(await relay(withOurRest())).toMatchObject({ delivered: 1, dropped: 1 })
    expect(await lastError(mineRefused)).toBe('twilio_21610')
    refuse = null
    expect(used.sort()).toEqual([`twilio:${sidA}:Own A`, `twilio:${sidA}:Own A`, `twilio:${sidOurs}:None`, `twilio:${sidOurs}:None`].sort())
  })
})

