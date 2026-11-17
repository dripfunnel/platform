import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { platformSchema } from '#apis/platform/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import type { PartnerCaller } from '#auth/partnerCaller'
import { secretBox, type SecretBox } from '#auth/secretBox'
import type { StaffMember, StaffRole } from '#auth/staff'
import { smsMessages, type OutgoingSms, type SmsAccountCheck, type SmsRoute } from '#core/sms'
import type { WhatsAppAccountCheck } from '#core/whatsapp'
import { withSystemScope } from '#db/scoped/index'
import { smsDeliverer, type SmsSenders } from '#jobs/queues/deliverers/sms'
import { defaultRelayOptions, relayDue } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createPartnerSmsService, createPartnerWhatsAppService } from '#saas/partnerCredentials/index'
import { createPlatformMessagingService } from '#saas/platformMessaging/index'
import { codeChannelsFor } from '#saas/portalCodes/index'
import { ourSmsFor, queueSms, savedOurSmsRoutes, smsAccountsFor, smsDeliveryFor } from '#saas/sms/index'
import { ourWhatsAppFor, savedOurWhatsApp, whatsappAccountsFor, whatsappSendsCodes } from '#saas/whatsapp/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #1543: DripFunnel's own SMS and WhatsApp accounts set in the admin console, switched on per partner by Admin, the
// partner choosing whose account sends; through both real schemas, the services and the database.

let db: TestDatabase
let box: SecretBox
const now = new Date('2026-11-17T09:00:00Z')
const staffByRole = new Map<StaffRole, StaffMember>()
let manager: StaffMember
const ids = { ns: '', kl: '', bare: '' }
const request = new Request('https://admin.dripfunnel.ai/api', { headers: { 'cf-ray': 'ray-test', 'cf-connecting-ip': '203.0.113.5', 'user-agent': 'test' } })
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }

let smsVerdict: SmsAccountCheck = 'ok'
let whatsappVerdict: WhatsAppAccountCheck = { status: 'ok' }

const msg91Key = '400000DripFunnelOurs01'
const twilioToken = 'd'.repeat(28) + 'f00d'
const ourSid = `AC${'d'.repeat(32)}`
const ownSid = `AC${'e'.repeat(32)}`
const metaToken = 'EAAGdripfunnelOursToken0001'
const ownMetaToken = 'EAAGpartnerOwnToken00000001'
const templates = smsMessages.map((message, i) => ({ message, templateId: `df${i}` }))
const msg91Input = { provider: 'msg91', authKey: msg91Key, templates }
const twilioInput = { provider: 'twilio', accountSid: ourSid, authToken: twilioToken, messagingServiceSid: `MG${'d'.repeat(32)}` }
const whatsappInput = (withCode = true) => ({
  accessToken: metaToken,
  businessAccountId: '900000000000001',
  phoneNumberId: '900000000000002',
  language: 'en',
  templates: [{ message: 'code.portal', name: withCode ? 'df_code' : '' }, { message: 'cart.reminder', name: 'df_cart' }],
})

const ourSms = () => ourSmsFor(savedOurSmsRoutes(box))
const ourWhatsApp = () => ourWhatsAppFor(savedOurWhatsApp(box))

const adminContext = (staff: StaffMember): AdminContext => ({
  staff,
  isAssigned: (staffId, target) => isAssigned(db.sql, staffId, target),
  staffActivity: null,
  partners: null,
  stores: null,
  provisioning: null,
  staffSessions: null,
  customers: null,
  staffMembers: null,
  dashboard: null,
  messaging: createPlatformMessagingService({
    sql: db.sql,
    staff,
    facts: factsOf(request),
    activity: activityLog,
    secrets: box,
    checkSms: async () => smsVerdict,
    checkWhatsApp: async () => whatsappVerdict,
    now: () => now,
  }),
})

const admin = async <T = Record<string, unknown>>(source: string, staff: StaffMember, variables: Record<string, unknown> = {}) => {
  const result = await graphql({ schema: adminSchema as GraphQLSchema, source, variableValues: variables, contextValue: adminContext(staff) })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, text: JSON.stringify(result) }
}

const callerOf = (partnerId: string): PartnerCaller => ({
  role: 'partner-owner',
  user: { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: null,
  partner: { id: partnerId, name: 'Partner', product: 'Partner Shops', host: null, state: 'live' },
})

const partner = async <T = Record<string, unknown>>(source: string, partnerId: string, variables: Record<string, unknown> = {}) => {
  const caller = callerOf(partnerId)
  const deps = { sql: db.sql, caller, facts, activity: activityLog, secrets: box, now: () => now }
  const sms = createPartnerSmsService({ ...deps, checkSms: async () => 'ok', ourSms: ourSms() })
  const whatsapp = createPartnerWhatsAppService({ ...deps, checkWhatsApp: async () => ({ status: 'ok' }), ourWhatsApp: ourWhatsApp() })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, sms, whatsapp } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, text: JSON.stringify(result) }
}

const as = (role: StaffRole): StaffMember => {
  const s = staffByRole.get(role)
  if (!s) throw new Error(`no seeded staff with role ${role}`)
  return s
}

const listSms = `{ platformSms { routes { route provider serving } accounts { provider hint status lastTestedAt templatesComplete } } }`
const listWhatsApp = `{ platformWhatsApp { enabled account { hint phoneNumberId status templates { message name } } } }`
const saveSms = `mutation($provider: String!, $authKey: String, $templates: [PlatformSmsTemplateInput!], $accountSid: String, $authToken: String, $messagingServiceSid: String, $reason: String!) {
  savePlatformSmsAccount(provider: $provider, authKey: $authKey, templates: $templates, accountSid: $accountSid, authToken: $authToken, messagingServiceSid: $messagingServiceSid, reason: $reason) { ok reason status } }`
const testSms = `mutation($provider: String!) { testPlatformSmsAccount(provider: $provider) { ok reason status } }`
const removeSms = `mutation($provider: String!, $reason: String!) { removePlatformSmsAccount(provider: $provider, reason: $reason) { ok reason } }`
const routeSms = `mutation($route: String!, $provider: String, $reason: String!) { setPlatformSmsRoute(route: $route, provider: $provider, reason: $reason) { ok reason } }`
const saveWhatsApp = `mutation($accessToken: String!, $businessAccountId: String!, $phoneNumberId: String!, $language: String!, $templates: [PlatformWhatsAppTemplateInput!]!, $reason: String!) {
  savePlatformWhatsAppAccount(accessToken: $accessToken, businessAccountId: $businessAccountId, phoneNumberId: $phoneNumberId, language: $language, templates: $templates, reason: $reason) { ok reason status problem } }`
const testWhatsApp = `mutation { testPlatformWhatsAppAccount { ok reason status problem } }`
const onWhatsApp = `mutation($enabled: Boolean!, $reason: String!) { setPlatformWhatsAppEnabled(enabled: $enabled, reason: $reason) { ok reason } }`
const removeWhatsApp = `mutation($reason: String!) { removePlatformWhatsAppAccount(reason: $reason) { ok reason } }`
const setSwitch = `mutation($partnerId: ID!, $channel: String!, $enabled: Boolean!, $reason: String!) { setPartnerDfMessaging(partnerId: $partnerId, channel: $channel, enabled: $enabled, reason: $reason) { sms whatsapp } }`
const readSwitch = `query($partnerId: ID!) { partnerDfMessaging(partnerId: $partnerId) { sms whatsapp } }`
const why = { reason: 'Launch for the pilot partners' }

const sw = (partnerId: string, channel: 'sms' | 'whatsapp', enabled: boolean) => admin(setSwitch, as('staff-super-admin'), { partnerId, channel, enabled, ...why })
const resolveSms = (partnerId: string, route: SmsRoute) => withSystemScope(db.sql, (tx) => smsAccountsFor(box, ourSms()).forPartner(tx, partnerId, route))
const resolveWhatsApp = (partnerId: string) => withSystemScope(db.sql, (tx) => whatsappAccountsFor(box, ourWhatsApp()).forPartner(tx, partnerId))
const channelsOf = (partnerId: string, phone: string | null) =>
  withSystemScope(db.sql, (tx) => codeChannelsFor(smsDeliveryFor(box), (inner, id) => whatsappSendsCodes(inner, box, ourWhatsApp(), id)).forPartner(tx, partnerId, phone))

beforeAll(async () => {
  db = await createTestDatabase()
  box = await secretBox(Buffer.alloc(32, 5).toString('base64'))
  await seed(db.url, now)
  for (const role of ['staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
    await db.sql`insert into staff_user (sso_subject, email, name, role_key, status) select ${`sso-${role}`}, ${`${role}@dripfunnel.example`}, ${role}, ${role}, 'active' where not exists (select 1 from staff_user where role_key = ${role})`
  }
  for (const r of await db.sql<{ id: string; email: string; name: string; role_key: StaffRole }[]>`select id, email, name, role_key from staff_user order by created_at`) {
    const member = { id: r.id, email: r.email, name: r.name, role: r.role_key }
    if (!staffByRole.has(r.role_key)) staffByRole.set(r.role_key, member)
    if (r.email === 'priya@softobotics.example') manager = member
  }
  for (const [key, name] of [['ns', 'Northstar Commerce'], ['kl', 'Kaufladen Digital']] as const) ids[key] = (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  ids.bare = (await db.sql<{ id: string }[]>`insert into partner (name, state) values ('No accounts', 'live') returning id`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db?.drop()
})

describe('DripFunnel’s accounts in the admin console', () => {
  it('starts with no account, no route and WhatsApp off, and every partner’s switches off', async () => {
    expect((await admin(listSms, as('staff-read-only'))).data).toEqual({ platformSms: { routes: [{ route: 'india', provider: null, serving: null }, { route: 'rest', provider: null, serving: null }], accounts: [] } })
    expect((await admin(listWhatsApp, as('staff-finance'))).data).toEqual({ platformWhatsApp: { enabled: false, account: null } })
    expect((await db.sql`select 1 from partner where df_sms_enabled or df_whatsapp_enabled`).length).toBe(0)
  })

  it('lets a Super admin save checked accounts, sealed, and shows every role only the provider, last four, status and routes', async () => {
    expect((await admin(saveSms, as('staff-super-admin'), { ...msg91Input, ...why })).data).toEqual({ savePlatformSmsAccount: { ok: true, reason: null, status: 'ok' } })
    expect((await admin(saveSms, as('staff-super-admin'), { ...twilioInput, ...why })).data?.['savePlatformSmsAccount']).toMatchObject({ ok: true })
    for (const role of ['staff-partner-manager', 'staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
      const shown = await admin(listSms, as(role))
      expect(shown.data).toEqual({
        platformSms: {
          routes: [{ route: 'india', provider: null, serving: 'msg91' }, { route: 'rest', provider: null, serving: 'twilio' }],
          accounts: [
            { provider: 'msg91', hint: '…rs01', status: 'ok', lastTestedAt: now.toISOString(), templatesComplete: true },
            { provider: 'twilio', hint: '…f00d', status: 'ok', lastTestedAt: now.toISOString(), templatesComplete: null },
          ],
        },
      })
      expect(shown.text).not.toContain(msg91Key)
      expect(shown.text).not.toContain(twilioToken)
    }
    const stored = await db.sql<{ key_enc: string }[]>`select key_enc from platform_credential where kind = 'sms'`
    expect(stored.every((r) => r.key_enc.startsWith('v1.'))).toBe(true)
    expect(JSON.stringify(stored)).not.toContain(msg91Key)
  })

  it('refuses a rejected or unreachable account, a malformed one and a write without a reason, keeping what was saved', async () => {
    const sa = as('staff-super-admin')
    smsVerdict = 'rejected'
    expect((await admin(saveSms, sa, { ...twilioInput, authToken: 'a'.repeat(32), ...why })).data?.['savePlatformSmsAccount']).toMatchObject({ ok: false, reason: 'KEY_REJECTED' })
    smsVerdict = 'unavailable'
    expect((await admin(saveSms, sa, { ...twilioInput, ...why })).data?.['savePlatformSmsAccount']).toMatchObject({ ok: false, reason: 'PROVIDER_UNAVAILABLE' })
    smsVerdict = 'ok'
    expect((await admin(saveSms, sa, { ...msg91Input, templates: templates.slice(1), ...why })).data?.['savePlatformSmsAccount']).toMatchObject({ ok: false, reason: 'TEMPLATES_INCOMPLETE' })
    expect((await admin(saveSms, sa, { ...twilioInput, reason: ' ' })).data?.['savePlatformSmsAccount']).toMatchObject({ ok: false, reason: 'INVALID_INPUT' })
    expect((await db.sql<{ key_prefix: string }[]>`select key_prefix from platform_credential where provider = 'twilio'`)[0]?.key_prefix).toBe('…f00d')
  })

  it('tests, routes and removes an account, each audited with the staff member and the reason, never a secret', async () => {
    const sa = as('staff-super-admin')
    smsVerdict = 'rejected'
    expect((await admin(testSms, sa, { provider: 'twilio' })).data?.['testPlatformSmsAccount']).toEqual({ ok: true, reason: null, status: 'rejected' })
    smsVerdict = 'ok'
    expect((await admin(testSms, sa, { provider: 'twilio' })).data?.['testPlatformSmsAccount']).toEqual({ ok: true, reason: null, status: 'ok' })
    expect((await admin(routeSms, sa, { route: 'india', provider: 'sns', ...why })).data?.['setPlatformSmsRoute']).toEqual({ ok: false, reason: 'ACCOUNT_INCOMPLETE' })
    expect((await admin(routeSms, sa, { route: 'india', provider: 'twilio', ...why })).data?.['setPlatformSmsRoute']).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    expect((await admin(routeSms, sa, { route: 'india', provider: 'msg91', ...why })).data?.['setPlatformSmsRoute']).toEqual({ ok: true, reason: null })
    await admin(saveSms, sa, { provider: 'msg91', authKey: '400000ToBeRemoved0001', templates, ...why })
    expect((await admin(removeSms, sa, { provider: 'msg91', ...why })).data?.['removePlatformSmsAccount']).toEqual({ ok: true, reason: null })
    expect((await admin(removeSms, sa, { provider: 'msg91', ...why })).data?.['removePlatformSmsAccount']).toEqual({ ok: false, reason: 'NOT_FOUND' })
    await admin(saveSms, sa, { ...msg91Input, ...why })
    const rows = await db.sql<{ action: string; actor_label: string; reason: string | null; visibility: string; entry: string }[]>`
      select action, actor_label, reason, visibility, row_to_json(activity_log)::text as entry from activity_log where action like 'platform.sms%'`
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['platform.sms_account_saved', 'platform.sms_account_tested', 'platform.sms_route_set', 'platform.sms_account_removed']))
    for (const r of rows) {
      expect(r.actor_label).toContain(sa.email)
      expect(r.visibility).toBe('staff')
      expect(r.entry).not.toContain(msg91Key)
      expect(r.entry).not.toContain(twilioToken)
    }
    expect(rows.filter((r) => r.action !== 'platform.sms_account_tested').every((r) => r.reason === why.reason)).toBe(true)
  })

  it('takes DripFunnel’s WhatsApp: saved checked, on only with code.portal, a rejected test turning it off, removed with it', async () => {
    const sa = as('staff-super-admin')
    expect((await admin(onWhatsApp, sa, { enabled: true, ...why })).data?.['setPlatformWhatsAppEnabled']).toEqual({ ok: false, reason: 'NO_ACCOUNT' })
    whatsappVerdict = { status: 'rejected', problem: 'token' }
    expect((await admin(saveWhatsApp, sa, { ...whatsappInput(), ...why })).data?.['savePlatformWhatsAppAccount']).toMatchObject({ ok: false, reason: 'KEY_REJECTED', problem: 'token' })
    whatsappVerdict = { status: 'ok' }
    expect((await admin(saveWhatsApp, sa, { ...whatsappInput(false), ...why })).data?.['savePlatformWhatsAppAccount']).toMatchObject({ ok: true })
    expect((await admin(onWhatsApp, sa, { enabled: true, ...why })).data?.['setPlatformWhatsAppEnabled']).toEqual({ ok: false, reason: 'NO_CODE_TEMPLATE' })
    await admin(saveWhatsApp, sa, { ...whatsappInput(), ...why })
    expect((await admin(onWhatsApp, sa, { enabled: true, ...why })).data?.['setPlatformWhatsAppEnabled']).toEqual({ ok: true, reason: null })
    expect((await admin(saveWhatsApp, sa, { ...whatsappInput(false), ...why })).data?.['savePlatformWhatsAppAccount']).toMatchObject({ ok: false, reason: 'NO_CODE_TEMPLATE' })
    whatsappVerdict = { status: 'rejected', problem: 'phone_number' }
    expect((await admin(testWhatsApp, sa)).data?.['testPlatformWhatsAppAccount']).toEqual({ ok: true, reason: null, status: 'rejected', problem: 'phone_number' })
    expect((await admin(listWhatsApp, as('staff-support'))).data?.['platformWhatsApp']).toMatchObject({ enabled: false, account: { hint: '…0001', status: 'rejected' } })
    whatsappVerdict = { status: 'ok' }
    await admin(testWhatsApp, sa)
    await admin(onWhatsApp, sa, { enabled: true, ...why })
    expect((await admin(removeWhatsApp, sa, why)).data?.['removePlatformWhatsAppAccount']).toEqual({ ok: true, reason: null })
    expect((await admin(listWhatsApp, sa)).data).toEqual({ platformWhatsApp: { enabled: false, account: null } })
    expect((await admin(listWhatsApp, sa)).text).not.toContain(metaToken)
    await admin(saveWhatsApp, sa, { ...whatsappInput(), ...why })
    await admin(onWhatsApp, sa, { enabled: true, ...why })
  })
})

describe('who may', () => {
  it('lets only a Super admin change DripFunnel’s accounts; every other role is refused every write', async () => {
    const writes = [
      [saveSms, { ...twilioInput, ...why }],
      [testSms, { provider: 'twilio' }],
      [removeSms, { provider: 'sns', ...why }],
      [routeSms, { route: 'rest', provider: null, ...why }],
      [saveWhatsApp, { ...whatsappInput(), ...why }],
      [testWhatsApp, {}],
      [onWhatsApp, { enabled: true, ...why }],
      [removeWhatsApp, why],
    ] as const
    for (const role of ['staff-partner-manager', 'staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
      for (const [source, variables] of writes) expect((await admin(source, as(role), variables)).code, `${role} ${source.slice(0, 40)}`).toBe('FORBIDDEN')
    }
    expect((await admin(listWhatsApp, as('staff-super-admin'))).data?.['platformWhatsApp']).toMatchObject({ enabled: true })
  })

  it('lets a Super admin and an assigned Partner manager switch a partner, refusing an unassigned one and every other role', async () => {
    expect((await admin(setSwitch, as('staff-super-admin'), { partnerId: ids.ns, channel: 'sms', enabled: true, ...why })).data).toEqual({ setPartnerDfMessaging: { sms: true, whatsapp: false } })
    expect((await admin(setSwitch, manager, { partnerId: ids.kl, channel: 'whatsapp', enabled: true, ...why })).data).toEqual({ setPartnerDfMessaging: { sms: false, whatsapp: true } })
    expect((await admin(setSwitch, manager, { partnerId: ids.ns, channel: 'sms', enabled: false, ...why })).code).toBe('FORBIDDEN')
    for (const role of ['staff-support', 'staff-finance', 'staff-engineer', 'staff-read-only'] as const) {
      expect((await admin(setSwitch, as(role), { partnerId: ids.ns, channel: 'sms', enabled: false, ...why })).code).toBe('FORBIDDEN')
    }
    expect((await admin(setSwitch, as('staff-super-admin'), { partnerId: ids.ns, channel: 'sms', enabled: true, reason: '' })).code).toBe('INVALID_INPUT')
    expect((await admin(setSwitch, as('staff-super-admin'), { partnerId: ids.ns, channel: 'email', enabled: true, ...why })).code).toBe('INVALID_INPUT')
    expect((await admin(readSwitch, as('staff-read-only'), { partnerId: ids.ns })).data).toEqual({ partnerDfMessaging: { sms: true, whatsapp: false } })
    const entries = await db.sql<{ action: string; reason: string; visibility: string; partner_id: string }[]>`select action, reason, visibility, partner_id from activity_log where action like 'partner.df_%' order by occurred_at`
    expect(entries).toEqual([
      { action: 'partner.df_sms_enabled', reason: why.reason, visibility: 'partner', partner_id: ids.ns },
      { action: 'partner.df_whatsapp_enabled', reason: why.reason, visibility: 'partner', partner_id: ids.kl },
    ])
    await sw(ids.ns, 'sms', false)
    await sw(ids.kl, 'whatsapp', false)
  })
})

describe('which account sends', () => {
  it('gives a partner without its own account no SMS while Admin’s switch is off, and DripFunnel’s once it is on', async () => {
    expect(await resolveSms(ids.bare, 'rest')).toBeNull()
    expect(await channelsOf(ids.bare, '+16145550100')).toEqual({ whatsapp: false, sms: false })
    expect((await partner(`{ smsAccounts { dripfunnel routes { route provider dripfunnel sender } } }`, ids.bare)).data).toEqual({
      smsAccounts: { dripfunnel: false, routes: [{ route: 'india', provider: null, dripfunnel: false, sender: null }, { route: 'rest', provider: null, dripfunnel: false, sender: null }] },
    })
    await sw(ids.bare, 'sms', true)
    expect(await resolveSms(ids.bare, 'rest')).toMatchObject({ provider: 'twilio', accountSid: ourSid, authToken: twilioToken })
    expect(await resolveSms(ids.bare, 'india')).toMatchObject({ provider: 'msg91', authKey: msg91Key })
    expect(await channelsOf(ids.bare, '+16145550100')).toEqual({ whatsapp: false, sms: true })
    const shown = await partner(`{ smsAccounts { dripfunnel routes { route provider dripfunnel sender } } }`, ids.bare)
    expect(shown.data).toEqual({ smsAccounts: { dripfunnel: true, routes: [{ route: 'india', provider: null, dripfunnel: true, sender: 'dripfunnel' }, { route: 'rest', provider: null, dripfunnel: true, sender: 'dripfunnel' }] } })
    expect(shown.text).not.toContain(twilioToken)
    // The partner's own switch still decides whether SMS is used at all.
    await db.sql`update partner set sms_enabled = false where id = ${ids.bare}`
    expect(await resolveSms(ids.bare, 'rest')).toBe('off')
    await db.sql`update partner set sms_enabled = true where id = ${ids.bare}`
  })

  it('lets a partner with its own account and DripFunnel’s choose per route, and honours the choice', async () => {
    const own = { provider: 'twilio', accountSid: ownSid, authToken: 'e'.repeat(28) + 'beef', messagingServiceSid: `MG${'e'.repeat(32)}` }
    await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, status, created_by)
      values (${ids.kl}, 'sms', 'twilio', 'Twilio', ${await box.seal(own.authToken)}, '…beef', ${JSON.stringify({ accountSid: own.accountSid, messagingServiceSid: own.messagingServiceSid })}::text::jsonb, 'ok', 'test')`
    const route = (r: string, provider: string | null) => partner<{ setSmsRoute: { ok: boolean; reason: string | null } }>(`mutation($r: String!, $p: String) { setSmsRoute(route: $r, provider: $p) { ok reason } }`, ids.kl, { r, p: provider })
    expect((await route('rest', 'dripfunnel')).data?.setSmsRoute).toEqual({ ok: false, reason: 'DRIPFUNNEL_UNAVAILABLE' })
    await sw(ids.kl, 'sms', true)
    // With both, its own sends until it chooses DripFunnel's; India, which it has no account for, goes by DripFunnel's.
    expect(await resolveSms(ids.kl, 'rest')).toMatchObject({ accountSid: ownSid })
    expect(await resolveSms(ids.kl, 'india')).toMatchObject({ provider: 'msg91', authKey: msg91Key })
    expect((await route('rest', 'dripfunnel')).data?.setSmsRoute).toEqual({ ok: true, reason: null })
    expect(await resolveSms(ids.kl, 'rest')).toMatchObject({ accountSid: ourSid })
    expect((await partner(`{ smsAccounts { routes { route provider sender } } }`, ids.kl)).data).toEqual({
      smsAccounts: { routes: [{ route: 'india', provider: null, sender: 'dripfunnel' }, { route: 'rest', provider: 'dripfunnel', sender: 'dripfunnel' }] },
    })
    expect((await route('rest', 'twilio')).data?.setSmsRoute).toEqual({ ok: true, reason: null })
    expect(await resolveSms(ids.kl, 'rest')).toMatchObject({ accountSid: ownSid })
    expect((await route('rest', 'dripfunnel')).data?.setSmsRoute.ok).toBe(true)
    expect((await db.sql`select 1 from activity_log where partner_id = ${ids.kl} and action = 'partner.sms_route_set'`).length).toBe(3)
  })

  it('moves a route set to DripFunnel’s back to the partner’s own, or to none, when Admin turns it off, and keeps the choice', async () => {
    await sw(ids.kl, 'sms', false)
    expect(await resolveSms(ids.kl, 'rest')).toMatchObject({ accountSid: ownSid })
    expect(await resolveSms(ids.kl, 'india')).toBeNull()
    expect((await db.sql<{ sms_route_rest: string }[]>`select sms_route_rest from partner where id = ${ids.kl}`)[0]?.sms_route_rest).toBe('dripfunnel')
    expect((await partner(`{ smsAccounts { dripfunnel routes { route provider dripfunnel sender } } }`, ids.kl)).data).toEqual({
      smsAccounts: { dripfunnel: false, routes: [{ route: 'india', provider: null, dripfunnel: false, sender: null }, { route: 'rest', provider: 'dripfunnel', dripfunnel: false, sender: 'own' }] },
    })
    await sw(ids.kl, 'sms', true)
    expect(await resolveSms(ids.kl, 'rest')).toMatchObject({ accountSid: ourSid })
    await sw(ids.bare, 'sms', false)
    expect(await resolveSms(ids.bare, 'rest')).toBeNull()
  })

  it('sends a partner without WhatsApp of its own through DripFunnel’s once Admin enables it and the partner turns WhatsApp on', async () => {
    const on = (enabled: boolean) => partner<{ setWhatsAppEnabled: { ok: boolean; reason: string | null } }>(`mutation($e: Boolean!) { setWhatsAppEnabled(enabled: $e) { ok reason } }`, ids.bare, { e: enabled })
    expect((await on(true)).data?.setWhatsAppEnabled).toEqual({ ok: false, reason: 'NO_ACCOUNT' })
    await sw(ids.bare, 'whatsapp', true)
    // Admin enabling it starts nothing: the partner's own switch is still off.
    expect(await resolveWhatsApp(ids.bare)).toBeNull()
    expect((await channelsOf(ids.bare, null)).whatsapp).toBe(false)
    expect((await on(true)).data?.setWhatsAppEnabled).toEqual({ ok: true, reason: null })
    expect(await resolveWhatsApp(ids.bare)).toMatchObject({ accessToken: metaToken, phoneNumberId: '900000000000002', templates: { 'code.portal': 'df_code' } })
    expect((await channelsOf(ids.bare, null)).whatsapp).toBe(true)
    const shown = await partner(`{ whatsAppAccount { enabled dripfunnel choice sender account { hint } } }`, ids.bare)
    expect(shown.data).toEqual({ whatsAppAccount: { enabled: true, dripfunnel: true, choice: null, sender: 'dripfunnel', account: null } })
    expect(shown.text).not.toContain(metaToken)
  })

  it('lets a partner with its own WhatsApp choose DripFunnel’s, and goes back to its own when Admin turns DripFunnel’s off', async () => {
    const settings = { businessAccountId: '700000000000001', phoneNumberId: '700000000000002', language: 'en', templates: { 'code.portal': 'own_code' } }
    await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, status, created_by)
      values (${ids.kl}, 'whatsapp', 'meta', 'WhatsApp', ${await box.seal(ownMetaToken)}, '…0001', ${JSON.stringify(settings)}::text::jsonb, 'ok', 'test')`
    await db.sql`update partner set whatsapp_enabled = true where id = ${ids.kl}`
    const choose = (account: string) => partner<{ setWhatsAppChoice: { ok: boolean; reason: string | null } }>(`mutation($a: String!) { setWhatsAppChoice(account: $a) { ok reason } }`, ids.kl, { a: account })
    expect((await choose('dripfunnel')).data?.setWhatsAppChoice).toEqual({ ok: false, reason: 'DRIPFUNNEL_UNAVAILABLE' })
    expect((await choose('somebody')).data?.setWhatsAppChoice).toEqual({ ok: false, reason: 'INVALID_INPUT' })
    await sw(ids.kl, 'whatsapp', true)
    expect(await resolveWhatsApp(ids.kl)).toMatchObject({ accessToken: ownMetaToken })
    expect((await choose('dripfunnel')).data?.setWhatsAppChoice).toEqual({ ok: true, reason: null })
    expect(await resolveWhatsApp(ids.kl)).toMatchObject({ accessToken: metaToken })
    await sw(ids.kl, 'whatsapp', false)
    expect(await resolveWhatsApp(ids.kl)).toMatchObject({ accessToken: ownMetaToken })
    expect((await partner(`{ whatsAppAccount { dripfunnel choice sender } }`, ids.kl)).data).toEqual({ whatsAppAccount: { dripfunnel: false, choice: 'dripfunnel', sender: 'own' } })
    // A partner using DripFunnel's alone has no WhatsApp once Admin turns it off; its own switch stays as it set it.
    await sw(ids.bare, 'whatsapp', false)
    expect(await resolveWhatsApp(ids.bare)).toBeNull()
    expect((await channelsOf(ids.bare, null)).whatsapp).toBe(false)
    expect((await db.sql<{ whatsapp_enabled: boolean }[]>`select whatsapp_enabled from partner where id = ${ids.bare}`)[0]?.whatsapp_enabled).toBe(true)
    // DripFunnel's own switch off stops every partner's use of it, whatever Admin enabled.
    await sw(ids.bare, 'whatsapp', true)
    await admin(onWhatsApp, as('staff-super-admin'), { enabled: false, ...why })
    expect(await resolveWhatsApp(ids.bare)).toBeNull()
    await admin(onWhatsApp, as('staff-super-admin'), { enabled: true, ...why })
    expect(await resolveWhatsApp(ids.bare)).toMatchObject({ accessToken: metaToken })
  })
})

describe('isolation', () => {
  it('keeps every DripFunnel account row, and the route row, from every console role', async () => {
    for (const role of ['app_partner', 'app_platform', 'app_request']) {
      for (const query of ['select key_prefix from platform_credential', 'select key_enc from platform_credential', 'select sms_route_rest from platform_messaging']) {
        await expect(
          db.sql.begin(async (tx) => {
            await tx.unsafe(`set local role ${role}`)
            await tx.unsafe(query)
          }),
        ).rejects.toThrow(/permission denied/)
      }
    }
  })

  it('never lets a partner set Admin’s switches for itself', async () => {
    await expect(
      db.sql.begin(async (tx) => {
        await tx`select set_config('role', 'app_partner', true), set_config('app.scope', 'partner', true), set_config('app.partner_id', ${ids.kl}, true)`
        await tx`update partner set df_sms_enabled = true where id = ${ids.kl}`
      }),
    ).rejects.toThrow(/permission denied/)
  })

  it('shows a partner only its own choice and switches, and sends each partner’s texts through its own account or DripFunnel’s, never another’s', async () => {
    const ns = await partner<{ smsAccounts: { dripfunnel: boolean; routes: { provider: string | null }[]; accounts: unknown[] } }>(`{ smsAccounts { dripfunnel routes { provider } accounts { provider } } }`, ids.ns)
    expect(ns.data?.smsAccounts).toEqual({ dripfunnel: false, routes: [{ provider: null }, { provider: null }], accounts: [] })
    await db.sql`update partner set df_sms_enabled = false where id = ${ids.bare}`
    const used: string[] = []
    const sender = (name: string) => ({ send: async (sms: OutgoingSms) => (used.push(`${name}:${sms.to}`), { providerId: 'x' }) })
    const senders: SmsSenders = { msg91: () => sender('msg91'), twilio: (c) => sender(c.accountSid), sns: () => sender('sns') }
    const at = new Date((await db.sql<{ now: Date }[]>`select now() + interval '1 second' as now`)[0]?.now ?? now)
    const queue = (partnerId: string, to: string) => withSystemScope(db.sql, (tx) => queueSms(tx, { partnerId, storeId: null, idempotencyKey: `sms:${crypto.randomUUID()}`, payload: { message: 'order.confirmed', to, brand: 'Shop', vars: { order: 'X-1' }, expiresAt: null } }))
    await queue(ids.kl, '+16145550111')
    await queue(ids.ns, '+16145550112')
    await queue(ids.bare, '+16145550113')
    const accounts = smsDeliveryFor(box)
    if (!accounts) throw new Error('no sms deliverer')
    expect(await relayDue(db.sql, { sms: smsDeliverer(db.sql, accounts, senders, () => at) }, { ...defaultRelayOptions, now: () => at, baseDelayMs: 0 })).toMatchObject({ delivered: 1, dropped: 2 })
    // Kaufladen chose DripFunnel's for the rest of the world; Northstar and the bare partner have neither theirs nor ours.
    expect(used).toEqual([`${ourSid}:+16145550111`])
  })
})
