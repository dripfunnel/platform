import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secretBox } from '#auth/secretBox'
import { smsMessages, type OutgoingSms, type SmsAccountCheck } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import { selectSealedSmsAccount } from '#db/scoped/partnerSmsCredentials'
import { smsDeliverer, type SmsSenders } from '#jobs/queues/deliverers/sms'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createPartnerCredentialsService } from '#saas/partnerCredentials/index'
import { partnerSmsAccounts, queueSms, type SmsAccountDefaults, type SmsPayload } from '#saas/sms/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #1017: a partner's own SMS account, sealed and never read back, one partner never another's, and the account a text is
// sent through (the partner's complete one, else DripFunnel's) per provider.

let db: TestDatabase
const now = new Date('2026-10-30T09:00:00Z')
const ids = { ns: '', kl: '', a: '', b: '', c: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const kek = Buffer.alloc(32, 7).toString('base64')
const otherKek = Buffer.alloc(32, 9).toString('base64')

const msg91Key = 'M91authkeyAAAAAAAAAAAA1234'
const twilioA = { accountSid: `AC${'a'.repeat(32)}`, authToken: 'b'.repeat(32), messagingServiceSid: `MG${'c'.repeat(32)}` }
const templatesOf = (tag: string) => smsMessages.map((message, i) => ({ message, templateId: `${tag}${i}flowtmpl` }))

let verdict: SmsAccountCheck = 'ok'
const checked: string[] = []

const callerOf = (partnerId: string, role: PartnerRole, staff = false, impersonating = false): PartnerCaller => ({
  role,
  user: staff ? null : { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: staff || impersonating ? { id: crypto.randomUUID(), name: 'Priya Shah', email: 'priya@dripfunnel.example', session: { kind: impersonating ? 'impersonation' : 'setup', id: crypto.randomUUID(), expiresAt: new Date('2026-10-30T11:00:00Z') } } : null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const credentials = createPartnerCredentialsService({
    sql: db.sql,
    caller,
    facts,
    activity: activityLog,
    secrets: await secretBox(kek),
    checkKey: async () => null,
    checkSms: {
      msg91: async ({ authKey, templateId }) => {
        checked.push(`msg91:${authKey}:${templateId}`)
        return verdict
      },
      twilio: async (c) => {
        checked.push(`twilio:${c.accountSid}:${c.authToken}:${c.messagingServiceSid}`)
        return verdict
      },
    },
    now: () => now,
  })
  const contextValue = { caller, console: null, plans: null, branding: null, stores: null, storeActions: null, dashboard: null, domains: null, credentials }
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined }
}

const list = `{ smsAccounts { provider hint status lastTestedAt templatesComplete } }`
type Accounts = { smsAccounts: { provider: string; hint: string; status: string; lastTestedAt: string | null; templatesComplete: boolean | null }[] }
const save = `mutation($input: PartnerSmsAccountInput!) { saveSmsAccount(input: $input) { ok reason } }`
type Saved = { saveSmsAccount: { ok: boolean; reason: string | null } }
const test = `mutation($provider: String!) { testSmsAccount(provider: $provider) { ok reason status } }`
type Tested = { testSmsAccount: { ok: boolean; reason: string | null; status: string | null } }
const remove = `mutation($provider: String!) { removeSmsAccount(provider: $provider) { ok reason } }`

const msg91Input = (tag = 't', templates: { message: string; templateId: string }[] = templatesOf(tag)) => ({ input: { provider: 'msg91', authKey: msg91Key, templates } })
const twilioInput = (over: Record<string, string> = {}) => ({ input: { provider: 'twilio', ...twilioA, ...over } })

beforeAll(async () => {
  db = await createTestDatabase()
  await seed(db.url, now)
  for (const [key, name] of [['ns', 'Northstar Commerce'], ['kl', 'Kaufladen Digital']] as const) {
    ids[key] = (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  }
  for (const key of ['a', 'b', 'c'] as const) {
    ids[key] = (await db.sql<{ id: string }[]>`insert into partner (name, state) values (${`SMS ${key}`}, 'live') returning id`)[0]?.id ?? ''
  }
}, 120_000)

afterAll(async () => {
  await db.drop()
})

describe('the migration', () => {
  const row = (partner: string, kind: string, provider: string, name: string) =>
    db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, created_by) values (${partner}, ${kind}, ${provider}, ${name}, 'sealed', '…', 'test')`

  it('keeps each kind to its own providers', async () => {
    await expect(row(ids.c, 'sms', 'anthropic', 'Wrong')).rejects.toMatchObject({ code: '23514' })
    await expect(row(ids.c, 'ai', 'msg91', 'Wrong')).rejects.toMatchObject({ code: '23514' })
    await expect(row(ids.c, 'sms', 'gupshup', 'Wrong')).rejects.toMatchObject({ code: '23514' })
  })

  it('allows one SMS account per provider per partner, and leaves AI keys unchanged', async () => {
    await row(ids.c, 'sms', 'twilio', 'Twilio')
    await expect(row(ids.c, 'sms', 'twilio', 'Twilio again')).rejects.toMatchObject({ code: '23505' })
    await row(ids.c, 'sms', 'msg91', 'MSG91')
    await row(ids.c, 'ai', 'anthropic', 'Production')
    expect((await db.sql<{ settings: unknown }[]>`select settings from partner_credential where partner_id = ${ids.c} and kind = 'ai'`)[0]?.settings).toEqual({})
    await db.sql`delete from partner_credential where partner_id = ${ids.c}`
  })
})

describe('saving an account', () => {
  it('seals the MSG91 auth key, keeps the seven template ids, and shows only the last four characters', async () => {
    const result = await run<Saved>(save, callerOf(ids.ns, 'partner-owner'), msg91Input())
    expect(result.data?.saveSmsAccount.ok).toBe(true)
    const shown = await run<Accounts>(list, callerOf(ids.ns, 'partner-owner'))
    expect(shown.data?.smsAccounts).toEqual([{ provider: 'msg91', hint: '…1234', status: 'untested', lastTestedAt: null, templatesComplete: true }])
    expect(JSON.stringify(shown.data)).not.toContain(msg91Key)
    const stored = await db.sql<{ key_enc: string; settings: { templates: Record<string, string> } }[]>`select key_enc, settings from partner_credential where partner_id = ${ids.ns} and kind = 'sms'`
    expect(stored[0]?.key_enc).not.toContain(msg91Key)
    expect(Object.keys(stored[0]?.settings.templates ?? {}).sort()).toEqual([...smsMessages].sort())
    const sealed = await withSystemScope(db.sql, (tx) => selectSealedSmsAccount(tx, ids.ns, 'msg91'))
    expect(await (await secretBox(kek)).open(sealed?.key_enc ?? '')).toBe(msg91Key)
  })

  it('seals the Twilio auth token and keeps its two sids as settings', async () => {
    expect((await run<Saved>(save, callerOf(ids.ns, 'partner-owner'), twilioInput())).data?.saveSmsAccount.ok).toBe(true)
    const shown = (await run<Accounts>(list, callerOf(ids.ns, 'partner-owner'))).data?.smsAccounts ?? []
    expect(shown.find((a) => a.provider === 'twilio')).toMatchObject({ hint: '…bbbb', status: 'untested', templatesComplete: null })
    expect(JSON.stringify(shown)).not.toContain(twilioA.authToken)
    const sealed = await withSystemScope(db.sql, (tx) => selectSealedSmsAccount(tx, ids.ns, 'twilio'))
    expect(sealed?.settings).toEqual({ accountSid: twilioA.accountSid, messagingServiceSid: twilioA.messagingServiceSid })
  })

  it('refuses an MSG91 account without all seven template ids, and anything malformed', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    expect((await run<Saved>(save, owner, msg91Input('t', templatesOf('t').slice(0, 6)))).data?.saveSmsAccount).toEqual({ ok: false, reason: 'TEMPLATES_INCOMPLETE' })
    expect((await run<Saved>(save, owner, msg91Input('t', [])) ).data?.saveSmsAccount).toEqual({ ok: false, reason: 'TEMPLATES_INCOMPLETE' })
    const twice = [...templatesOf('t').slice(0, 6), templatesOf('t')[0] as { message: string; templateId: string }]
    expect((await run<Saved>(save, owner, msg91Input('t', twice))).data?.saveSmsAccount).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect((await run<Saved>(save, owner, msg91Input('t', [...templatesOf('t').slice(0, 6), { message: 'cart.reminder', templateId: 'abcdefgh' }]))).data?.saveSmsAccount.reason).toBe('INVALID_INPUT')
    expect((await run<Saved>(save, owner, msg91Input('t', [{ message: 'code.second_factor', templateId: 'x' }, ...templatesOf('t').slice(1)]))).data?.saveSmsAccount.reason).toBe('INVALID_INPUT')
    expect((await run<Saved>(save, owner, { input: { provider: 'msg91', authKey: 'short', templates: templatesOf('t') } })).data?.saveSmsAccount.reason).toBe('INVALID_INPUT')
    expect((await run<Saved>(save, owner, twilioInput({ accountSid: 'ACnope' }))).data?.saveSmsAccount.reason).toBe('INVALID_INPUT')
    expect((await run<Saved>(save, owner, { input: { provider: 'twilio', accountSid: twilioA.accountSid, authToken: twilioA.authToken } })).data?.saveSmsAccount.reason).toBe('INVALID_INPUT')
    expect((await run<Saved>(save, owner, { input: { provider: 'gupshup', authKey: msg91Key } })).data?.saveSmsAccount.reason).toBe('INVALID_INPUT')
    expect((await run<Saved>(save, owner, { input: { provider: 'twilio', ...twilioA, authKey: msg91Key } })).data?.saveSmsAccount.reason).toBe('INVALID_INPUT')
  })

  it('replaces an account saved again, so a provider has one', async () => {
    expect((await run<Saved>(save, callerOf(ids.ns, 'partner-owner'), twilioInput({ authToken: 'd'.repeat(32) }))).data?.saveSmsAccount.ok).toBe(true)
    const shown = (await run<Accounts>(list, callerOf(ids.ns, 'partner-owner'))).data?.smsAccounts ?? []
    expect(shown.filter((a) => a.provider === 'twilio')).toEqual([expect.objectContaining({ hint: '…dddd', status: 'untested' })])
    expect(shown).toHaveLength(2)
  })
})

describe('testing an account', () => {
  it('asks Twilio once with the saved values, and marks the account Working', async () => {
    verdict = 'ok'
    checked.length = 0
    const result = await run<Tested>(test, callerOf(ids.ns, 'partner-owner'), { provider: 'twilio' })
    expect(result.data?.testSmsAccount).toEqual({ ok: true, reason: null, status: 'ok' })
    expect(checked).toEqual([`twilio:${twilioA.accountSid}:${'d'.repeat(32)}:${twilioA.messagingServiceSid}`])
    const shown = (await run<Accounts>(list, callerOf(ids.ns, 'partner-owner'))).data?.smsAccounts ?? []
    expect(shown.find((a) => a.provider === 'twilio')).toMatchObject({ status: 'ok', lastTestedAt: now.toISOString() })
  })

  it('asks MSG91 with the sign-in code template, and marks a refused key Rejected', async () => {
    verdict = 'rejected'
    checked.length = 0
    const result = await run<Tested>(test, callerOf(ids.ns, 'partner-owner'), { provider: 'msg91' })
    expect(result.data?.testSmsAccount).toEqual({ ok: true, reason: null, status: 'rejected' })
    expect(checked).toEqual([`msg91:${msg91Key}:t0flowtmpl`])
    expect(((await run<Accounts>(list, callerOf(ids.ns, 'partner-owner'))).data?.smsAccounts ?? []).find((a) => a.provider === 'msg91')?.status).toBe('rejected')
  })

  it('leaves the status as it was when the provider could not be asked', async () => {
    verdict = 'unavailable'
    const result = await run<Tested>(test, callerOf(ids.ns, 'partner-owner'), { provider: 'msg91' })
    expect(result.data?.testSmsAccount).toEqual({ ok: false, reason: 'PROVIDER_UNAVAILABLE', status: null })
    expect(((await run<Accounts>(list, callerOf(ids.ns, 'partner-owner'))).data?.smsAccounts ?? []).find((a) => a.provider === 'msg91')?.status).toBe('rejected')
  })

  it('finds nothing to test for a provider with no saved account or an unknown one', async () => {
    expect((await run<Tested>(test, callerOf(ids.kl, 'partner-owner'), { provider: 'twilio' })).data?.testSmsAccount.reason).toBe('NOT_FOUND')
    expect((await run<Tested>(test, callerOf(ids.ns, 'partner-owner'), { provider: 'gupshup' })).data?.testSmsAccount.reason).toBe('NOT_FOUND')
  })
})

describe('who may', () => {
  it('lets Owner, Admin and a staff setup session save, and refuses Support, Finance and Read-only', async () => {
    for (const [role, staff, ok] of [['partner-admin', false, true], ['partner-owner', true, true], ['partner-support', false, false], ['partner-finance', false, false], ['partner-read-only', false, false]] as const) {
      const r = await run<Saved>(save, callerOf(ids.ns, role, staff), twilioInput())
      if (ok) expect(r.data?.saveSmsAccount.ok).toBe(true)
      else expect(r.code).toBe('FORBIDDEN')
    }
  })

  it('refuses the list to every role but Owner and Admin', async () => {
    for (const role of ['partner-support', 'partner-finance', 'partner-read-only'] as const) {
      expect((await run<Accounts>(list, callerOf(ids.ns, role))).code).toBe('FORBIDDEN')
    }
    expect((await run<Accounts>(list, callerOf(ids.ns, 'partner-admin'))).data?.smsAccounts.length).toBeGreaterThan(0)
  })

  it('refuses save, test and remove to an impersonation, and changes nothing', async () => {
    const imp = callerOf(ids.ns, 'partner-owner', false, true)
    const before = await db.sql`select id from partner_credential where partner_id = ${ids.ns} and kind = 'sms'`
    expect((await run<Saved>(save, imp, twilioInput())).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await run(test, imp, { provider: 'twilio' })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect((await run(remove, imp, { provider: 'twilio' })).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    expect(await db.sql`select id from partner_credential where partner_id = ${ids.ns} and kind = 'sms'`).toEqual(before)
  })
})

describe('isolation between partners', () => {
  it("never shows, tests or removes another partner's account", async () => {
    expect((await run<Accounts>(list, callerOf(ids.kl, 'partner-owner'))).data?.smsAccounts).toEqual([])
    expect((await run<Tested>(test, callerOf(ids.kl, 'partner-owner'), { provider: 'msg91' })).data?.testSmsAccount.reason).toBe('NOT_FOUND')
    expect((await run<{ removeSmsAccount: { reason: string } }>(remove, callerOf(ids.kl, 'partner-owner'), { provider: 'msg91' })).data?.removeSmsAccount.reason).toBe('NOT_FOUND')
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.ns} and kind = 'sms'`).length).toBe(2)
  })
})

describe('removing an account', () => {
  it('removes it once, and says there is nothing to remove the second time', async () => {
    const owner = callerOf(ids.ns, 'partner-owner')
    expect((await run<{ removeSmsAccount: { ok: boolean } }>(remove, owner, { provider: 'msg91' })).data?.removeSmsAccount.ok).toBe(true)
    expect((await run<{ removeSmsAccount: { reason: string } }>(remove, owner, { provider: 'msg91' })).data?.removeSmsAccount.reason).toBe('NOT_FOUND')
    expect(((await run<Accounts>(list, owner)).data?.smsAccounts ?? []).map((a) => a.provider)).toEqual(['twilio'])
  })
})

describe('the activity log', () => {
  it('records each write and test, and never a key or token', async () => {
    const rows = await db.sql<{ action: string; entry: string }[]>`select action, row_to_json(activity_log)::text as entry from activity_log where partner_id = ${ids.ns} and action like 'partner.sms_account_%'`
    expect(rows.map((r) => r.action)).toEqual(expect.arrayContaining(['partner.sms_account_saved', 'partner.sms_account_tested', 'partner.sms_account_removed']))
    for (const r of rows) {
      expect(r.entry).not.toContain(msg91Key)
      expect(r.entry).not.toContain(twilioA.authToken)
      expect(r.entry).not.toContain('d'.repeat(32))
    }
  })
})

describe('the account a text is sent through', () => {
  const ours: SmsAccountDefaults = {
    msg91: { provider: 'msg91', authKey: 'DRIPFUNNEL_MSG91_KEY', templates: Object.fromEntries(smsMessages.map((m) => [m, `ours-${m}`])) },
    twilio: { provider: 'twilio', accountSid: 'ACours', authToken: 'oursToken', messagingServiceSid: 'MGours' },
  }
  const resolve = async (partner: string, provider: 'msg91' | 'twilio', secrets = true) => withSystemScope(db.sql, async (tx) => partnerSmsAccounts(secrets ? await secretBox(kek) : null, ours).forPartner(tx, partner, provider))

  beforeAll(async () => {
    expect((await run<Saved>(save, callerOf(ids.a, 'partner-owner'), msg91Input('a'))).data?.saveSmsAccount.ok).toBe(true)
    expect((await run<Saved>(save, callerOf(ids.c, 'partner-owner'), twilioInput())).data?.saveSmsAccount.ok).toBe(true)
  })

  it('uses a partner’s complete MSG91 account for MSG91, with its own template ids', async () => {
    expect(await resolve(ids.a, 'msg91')).toEqual({ provider: 'msg91', authKey: msg91Key, templates: Object.fromEntries(templatesOf('a').map((t) => [t.message, t.templateId])) })
  })

  it('uses DripFunnel’s account where the partner has none for the provider, per provider', async () => {
    expect(await resolve(ids.a, 'twilio')).toEqual(ours.twilio)
    expect(await resolve(ids.b, 'msg91')).toEqual(ours.msg91)
    expect(await resolve(ids.b, 'twilio')).toEqual(ours.twilio)
    expect(await resolve(ids.c, 'msg91')).toEqual(ours.msg91)
    expect(await resolve(ids.c, 'twilio')).toEqual({ provider: 'twilio', ...twilioA })
  })

  it('falls back to DripFunnel’s for an MSG91 account that is not whole', async () => {
    const sealed = await (await secretBox(kek)).seal(msg91Key)
    await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, created_by) values (${ids.b}, 'sms', 'msg91', 'MSG91', ${sealed}, '…1234', ${db.sql.json({ templates: { 'code.second_factor': 'only-one-template' } })}, 'test')`
    expect(await resolve(ids.b, 'msg91')).toEqual(ours.msg91)
    await db.sql`delete from partner_credential where partner_id = ${ids.b}`
  })

  it('gives no account, not DripFunnel’s, for a saved secret that cannot be opened', async () => {
    expect(await resolve(ids.a, 'msg91', false)).toBeNull()
    const foreign = await (await secretBox(otherKek)).seal(msg91Key)
    await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, created_by) values (${ids.b}, 'sms', 'twilio', 'Twilio', ${foreign}, '…1234', ${db.sql.json({ accountSid: twilioA.accountSid, messagingServiceSid: twilioA.messagingServiceSid })}, 'test')`
    expect(await resolve(ids.b, 'twilio')).toBeNull()
    await db.sql`delete from partner_credential where partner_id = ${ids.b}`
  })

  it('sends each partner’s texts through its own account or DripFunnel’s, never another partner’s', async () => {
    const sent: { provider: string; authKey?: string; accountSid?: string; sms: OutgoingSms }[] = []
    const senders: SmsSenders = {
      msg91: (credentials) => ({ send: async (sms) => (sent.push({ provider: 'msg91', authKey: credentials.authKey, sms }), { providerId: 'p' }) }),
      twilio: (credentials) => ({ send: async (sms) => (sent.push({ provider: 'twilio', accountSid: credentials.accountSid, sms }), { providerId: 'p' }) }),
    }
    const at = new Date(((await db.sql<{ now: Date }[]>`select now() as now`)[0]?.now ?? new Date()).getTime() + 1000)
    const code = (to: string): SmsPayload => ({ message: 'code.second_factor', to, brand: 'Northstar', vars: { code: '482913' }, expiresAt: new Date(at.getTime() + 600_000).toISOString() })
    const queue = (partnerId: string, to: string) => withSystemScope(db.sql, (tx) => queueSms(tx, { partnerId, storeId: null, idempotencyKey: `sms:${crypto.randomUUID()}`, payload: code(to) }))
    await queue(ids.a, '+919845022113')
    await queue(ids.a, '+16145550199')
    await queue(ids.b, '+919845022113')
    await queue(ids.c, '+16145550199')
    const counts = await relayDue(db.sql, { sms: smsDeliverer(db.sql, partnerSmsAccounts(await secretBox(kek), ours), senders, () => at) }, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })
    expect(counts.delivered).toBe(4)
    expect(sent.find((s) => s.authKey === msg91Key)?.sms.dlt?.templateId).toBe('a0flowtmpl')
    expect(sent.filter((s) => s.authKey === 'DRIPFUNNEL_MSG91_KEY').map((s) => s.sms.dlt?.templateId)).toEqual(['ours-code.second_factor'])
    expect(sent.filter((s) => s.provider === 'twilio').map((s) => s.accountSid).sort()).toEqual([twilioA.accountSid, 'ACours'])
    expect(sent.filter((s) => s.authKey === msg91Key)).toHaveLength(1)
  })
})
