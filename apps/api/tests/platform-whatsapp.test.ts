import { graphql, type GraphQLSchema } from 'graphql'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { platformSchema } from '#apis/platform/schema'
import type { PartnerCaller } from '#auth/partnerCaller'
import type { PartnerRole } from '#auth/partnerPermissions'
import { secretBox, type SecretBox } from '#auth/secretBox'
import type { WhatsAppAccountCheck } from '#core/whatsapp'
import { withSystemScope } from '#db/scoped/index'
import { checkMetaWhatsAppAccount, metaWhatsAppSender } from '#integrations/meta/index'
import { activityLog } from '#saas/activity/index'
import { createPartnerWhatsAppService } from '#saas/partnerCredentials/index'
import { whatsappAccountsFor, type PartnerWhatsAppAccount } from '#saas/whatsapp/index'
import { seed } from '../scripts/seed/seed'
import { createTestDatabase, type TestDatabase } from './support/database'

// Card #1504: the partner's own WhatsApp Business account on Meta's Cloud API, saved, tested, turned on and off and removed
// through the Platform API, and read only for its own partner's messages.

let db: TestDatabase
let box: SecretBox
const now = new Date('2026-11-16T09:00:00Z')
const ids = { ns: '', kl: '', fresh: '' }
const facts = { requestId: 'r', ip: '203.0.113.9', userAgent: 'test' }
const kek = Buffer.alloc(32, 9).toString('base64')

const token = `EAAGm0PX4ZCpsBA${'k'.repeat(60)}Zq7w`
const input = {
  accessToken: token,
  businessAccountId: '102290129340398',
  phoneNumberId: '106540352242922',
  language: 'en',
  templates: [
    { message: 'code.portal', name: 'portal_code' },
    { message: 'cart.reminder', name: 'cart_reminder' },
    { message: 'cart.reminder_code', name: '' },
  ],
}

/** The check the service runs: the real one, against Meta's answers below, unless a test sets `verdict`. */
let verdict: WhatsAppAccountCheck | null = null
let metaAnswers: { phone: number; templateStatus: string } = { phone: 200, templateStatus: 'APPROVED' }
const checked: PartnerWhatsAppAccount[] = []
const metaFetch = (async (request: RequestInfo | URL) => {
  const url = new URL(String(request instanceof Request ? request.url : request))
  const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status })
  if (url.pathname.endsWith('/message_templates')) return json(200, { data: [{ name: url.searchParams.get('name'), language: 'en', status: metaAnswers.templateStatus, id: '1' }] })
  if (metaAnswers.phone === 401) return json(401, { error: { code: 190, message: 'Invalid OAuth access token' } })
  if (metaAnswers.phone === 400) return json(400, { error: { code: 100, message: 'Unsupported get request' } })
  return json(200, { id: input.phoneNumberId, display_phone_number: '+91 98000 00000', verified_name: 'Northstar' })
}) as typeof fetch

const callerOf = (partnerId: string, role: PartnerRole, staff = false, impersonating = false): PartnerCaller => ({
  role,
  user: staff ? null : { id: crypto.randomUUID(), name: 'Maya Chen', email: 'maya@northstar.example' },
  staff: staff || impersonating ? { id: crypto.randomUUID(), name: 'Priya Shah', email: 'priya@dripfunnel.example', session: { kind: impersonating ? 'impersonation' : 'setup', id: crypto.randomUUID(), expiresAt: new Date('2026-11-16T11:00:00Z') } } : null,
  partner: { id: partnerId, name: 'Northstar Commerce', product: 'Northstar Shops', host: null, state: 'live' },
})

const run = async <T>(source: string, caller: PartnerCaller, variables: Record<string, unknown> = {}) => {
  const whatsapp = createPartnerWhatsAppService({
    sql: db.sql,
    caller,
    facts,
    activity: activityLog,
    secrets: box,
    checkWhatsApp: async (account) => {
      checked.push(account)
      return verdict ?? checkMetaWhatsAppAccount({ ...account, fetchImpl: metaFetch })
    },
    ourWhatsApp: async () => null,
    now: () => now,
  })
  const result = await graphql({ schema: platformSchema as GraphQLSchema, source, variableValues: variables, contextValue: { caller, whatsapp } })
  const error = result.errors?.[0]
  if (error && error.extensions['code'] === undefined) throw error
  return { data: (result.data ?? null) as T | null, code: error?.extensions['code'] as string | undefined, text: JSON.stringify(result) }
}

const read = `{ whatsAppAccount { enabled account { hint businessAccountId phoneNumberId language templates { message name } status lastTestedAt } } }`
type Read = { whatsAppAccount: { enabled: boolean; account: { hint: string; businessAccountId: string; phoneNumberId: string; language: string; templates: { message: string; name: string | null }[]; status: string; lastTestedAt: string | null } | null } }
const save = `mutation($accessToken: String!, $businessAccountId: String!, $phoneNumberId: String!, $language: String!, $templates: [PartnerWhatsAppTemplateInput!]!) {
  saveWhatsAppAccount(accessToken: $accessToken, businessAccountId: $businessAccountId, phoneNumberId: $phoneNumberId, language: $language, templates: $templates) { ok reason status problem template } }`
type Result = { ok: boolean; reason: string | null; status: string | null; problem: string | null; template: string | null }
const test = `mutation { testWhatsAppAccount { ok reason status problem template } }`
const remove = `mutation { removeWhatsAppAccount { ok reason } }`
const setEnabled = `mutation($enabled: Boolean!) { setWhatsAppEnabled(enabled: $enabled) { ok reason } }`

beforeAll(async () => {
  db = await createTestDatabase()
  box = await secretBox(kek)
  await seed(db.url, now)
  for (const [key, name] of [['ns', 'Northstar Commerce'], ['kl', 'Kaufladen Digital']] as const) {
    ids[key] = (await db.sql<{ id: string }[]>`select id from partner where name = ${name}`)[0]?.id ?? ''
  }
  ids.fresh = (await db.sql<{ id: string }[]>`insert into partner (name, state) values ('WhatsApp fresh', 'live') returning id`)[0]?.id ?? ''
}, 120_000)

afterAll(async () => {
  await db.drop()
})

describe('the partner’s WhatsApp account', () => {
  it('starts off, with no account', async () => {
    expect((await run<Read>(read, callerOf(ids.ns, 'partner-owner'))).data?.whatsAppAccount).toEqual({ enabled: false, account: null })
  })

  it('refuses to turn WhatsApp on without a saved account', async () => {
    expect((await run<{ setWhatsAppEnabled: unknown }>(setEnabled, callerOf(ids.ns, 'partner-owner'), { enabled: true })).data?.setWhatsAppEnabled).toEqual({ ok: false, reason: 'NO_ACCOUNT' })
    expect((await db.sql<{ whatsapp_enabled: boolean }[]>`select whatsapp_enabled from partner where id = ${ids.ns}`)[0]?.whatsapp_enabled).toBe(false)
  })

  it('checks and seals the account, and shows back its last four, ids and templates, never the token', async () => {
    checked.length = 0
    const saved = await run<{ saveWhatsAppAccount: Result }>(save, callerOf(ids.ns, 'partner-owner'), input)
    expect(saved.data?.saveWhatsAppAccount).toEqual({ ok: true, reason: null, status: 'ok', problem: null, template: null })
    expect(saved.text).not.toContain(token)
    expect(checked).toEqual([{ accessToken: token, businessAccountId: input.businessAccountId, phoneNumberId: input.phoneNumberId, language: 'en', templates: { 'code.portal': 'portal_code', 'cart.reminder': 'cart_reminder' } }])
    const shown = await run<Read>(read, callerOf(ids.ns, 'partner-admin'))
    expect(shown.data?.whatsAppAccount).toEqual({
      enabled: false,
      account: {
        hint: '…Zq7w',
        businessAccountId: input.businessAccountId,
        phoneNumberId: input.phoneNumberId,
        language: 'en',
        templates: [{ message: 'code.portal', name: 'portal_code' }, { message: 'cart.reminder', name: 'cart_reminder' }, { message: 'cart.reminder_code', name: null }],
        status: 'ok',
        lastTestedAt: now.toISOString(),
      },
    })
    expect(shown.text).not.toContain(token)
    const stored = await db.sql<{ key_enc: string; settings: unknown }[]>`select key_enc, settings from partner_credential where partner_id = ${ids.ns} and kind = 'whatsapp'`
    expect(stored).toHaveLength(1)
    expect(stored[0]?.key_enc.startsWith('v1.')).toBe(true)
    expect(JSON.stringify(stored)).not.toContain(token)
  })

  it('replaces the partner’s one account on a second save, never adding another', async () => {
    expect((await run<{ saveWhatsAppAccount: Result }>(save, callerOf(ids.ns, 'partner-owner'), input)).data?.saveWhatsAppAccount.ok).toBe(true)
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.ns} and kind = 'whatsapp'`).length).toBe(1)
    await expect(db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, created_by) values (${ids.ns}, 'whatsapp', 'meta', 'WhatsApp 2', 'v1.x.y', '…x', 'test')`).rejects.toThrow(/partner_credential_account_key/)
    await expect(db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, created_by) values (${ids.fresh}, 'whatsapp', 'msg91', 'WhatsApp', 'v1.x.y', '…x', 'test')`).rejects.toThrow(/partner_credential_kind_provider/)
  })

  it('refuses a malformed value, a wrong token, an unknown number, a template not approved, and Meta down, saving nothing', async () => {
    const caller = callerOf(ids.fresh, 'partner-owner')
    const answer = async (o: Record<string, unknown>) => (await run<{ saveWhatsAppAccount: Result }>(save, caller, { ...input, ...o })).data?.saveWhatsAppAccount
    expect((await answer({ phoneNumberId: 'abc' }))?.reason).toBe('INVALID_INPUT')
    expect((await answer({ accessToken: 'short' }))?.reason).toBe('INVALID_INPUT')
    expect((await answer({ language: 'English' }))?.reason).toBe('INVALID_INPUT')
    expect((await answer({ templates: [{ message: 'marketing.blast', name: 'x' }] }))?.reason).toBe('INVALID_INPUT')
    expect((await answer({ templates: [{ message: 'cart.reminder', name: 'Cart Reminder' }] }))?.reason).toBe('INVALID_INPUT')
    expect((await answer({ templates: [{ message: 'cart.reminder', name: 'a' }, { message: 'cart.reminder', name: 'b' }] }))?.reason).toBe('INVALID_INPUT')
    metaAnswers = { phone: 401, templateStatus: 'APPROVED' }
    expect(await answer({})).toMatchObject({ ok: false, reason: 'KEY_REJECTED', problem: 'token' })
    metaAnswers = { phone: 400, templateStatus: 'APPROVED' }
    expect(await answer({})).toMatchObject({ ok: false, reason: 'KEY_REJECTED', problem: 'phone_number' })
    metaAnswers = { phone: 200, templateStatus: 'PENDING' }
    expect(await answer({ templates: [{ message: 'code.portal', name: 'portal_code' }] })).toMatchObject({ ok: false, reason: 'KEY_REJECTED', problem: 'template', template: 'code.portal' })
    metaAnswers = { phone: 200, templateStatus: 'APPROVED' }
    verdict = { status: 'unavailable' }
    expect((await answer({}))?.reason).toBe('PROVIDER_UNAVAILABLE')
    verdict = null
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.fresh}`).length).toBe(0)
  })

  it('tests the saved account against Meta and marks it Working or Rejected, naming what Meta refused', async () => {
    const caller = callerOf(ids.ns, 'partner-owner')
    const tested = async () => (await run<{ testWhatsAppAccount: Result }>(test, caller)).data?.testWhatsAppAccount
    const status = async () => (await run<Read>(read, caller)).data?.whatsAppAccount.account?.status
    metaAnswers = { phone: 401, templateStatus: 'APPROVED' }
    expect(await tested()).toEqual({ ok: true, reason: null, status: 'rejected', problem: 'token', template: null })
    expect(await status()).toBe('rejected')
    metaAnswers = { phone: 400, templateStatus: 'APPROVED' }
    expect(await tested()).toMatchObject({ status: 'rejected', problem: 'phone_number' })
    metaAnswers = { phone: 200, templateStatus: 'REJECTED' }
    expect(await tested()).toMatchObject({ status: 'rejected', problem: 'template' })
    metaAnswers = { phone: 200, templateStatus: 'APPROVED' }
    expect(await tested()).toEqual({ ok: true, reason: null, status: 'ok', problem: null, template: null })
    expect(await status()).toBe('ok')
    verdict = { status: 'unavailable' }
    expect(await tested()).toMatchObject({ ok: false, reason: 'PROVIDER_UNAVAILABLE' })
    verdict = null
    expect((await run<{ testWhatsAppAccount: Result }>(test, callerOf(ids.fresh, 'partner-owner'))).data?.testWhatsAppAccount).toMatchObject({ ok: false, reason: 'NOT_FOUND' })
  })

  it('turns WhatsApp on and off with a saved account, recording only a change', async () => {
    const caller = callerOf(ids.ns, 'partner-admin')
    expect((await run<{ setWhatsAppEnabled: unknown }>(setEnabled, caller, { enabled: true })).data?.setWhatsAppEnabled).toEqual({ ok: true, reason: null })
    expect((await run<Read>(read, caller)).data?.whatsAppAccount.enabled).toBe(true)
    await run(setEnabled, caller, { enabled: true })
    await run(setEnabled, caller, { enabled: false })
    await run(setEnabled, caller, { enabled: true })
    const entries = await db.sql<{ action: string }[]>`select action from activity_log where partner_id = ${ids.ns} and action in ('partner.whatsapp_enabled', 'partner.whatsapp_disabled')`
    expect(entries.map((e) => e.action).sort()).toEqual(['partner.whatsapp_disabled', 'partner.whatsapp_enabled', 'partner.whatsapp_enabled'])
  })

  it('removes the account and turns WhatsApp off with it, audited', async () => {
    const caller = callerOf(ids.kl, 'partner-owner')
    await run(save, caller, input)
    await run(setEnabled, caller, { enabled: true })
    expect((await run<{ removeWhatsAppAccount: unknown }>(remove, caller)).data?.removeWhatsAppAccount).toEqual({ ok: true, reason: null })
    expect((await run<Read>(read, caller)).data?.whatsAppAccount).toEqual({ enabled: false, account: null })
    expect((await run<{ removeWhatsAppAccount: unknown }>(remove, caller)).data?.removeWhatsAppAccount).toEqual({ ok: false, reason: 'NOT_FOUND' })
    const [entry] = await db.sql<{ changes: unknown }[]>`select changes from activity_log where partner_id = ${ids.kl} and action = 'partner.whatsapp_account_removed'`
    expect(JSON.stringify(entry?.changes)).toContain('whatsapp_enabled')
  })

  it('turns WhatsApp on only with an approved code.portal template, and keeps it so while on', async () => {
    const caller = callerOf(ids.fresh, 'partner-owner')
    const on = async () => (await run<{ setWhatsAppEnabled: Result }>(setEnabled, caller, { enabled: true })).data?.setWhatsAppEnabled.reason
    const enabled = async () => (await run<Read>(read, caller)).data?.whatsAppAccount.enabled
    const withoutCode = { templates: [{ message: 'cart.reminder', name: 'cart_reminder' }] }
    // Saved without code.portal: no codes by WhatsApp, so no On.
    expect((await run<{ saveWhatsAppAccount: Result }>(save, caller, { ...input, ...withoutCode })).data?.saveWhatsAppAccount.ok).toBe(true)
    expect(await on()).toBe('NO_CODE_TEMPLATE')
    // Named, but the last check says Rejected.
    expect((await run<{ saveWhatsAppAccount: Result }>(save, caller, input)).data?.saveWhatsAppAccount.ok).toBe(true)
    metaAnswers = { phone: 200, templateStatus: 'PENDING' }
    expect((await run<{ testWhatsAppAccount: Result }>(test, caller)).data?.testWhatsAppAccount.status).toBe('rejected')
    metaAnswers = { phone: 200, templateStatus: 'APPROVED' }
    expect(await on()).toBe('NO_CODE_TEMPLATE')
    expect(await enabled()).toBe(false)
    // Working with code.portal: On.
    expect((await run<{ testWhatsAppAccount: Result }>(test, caller)).data?.testWhatsAppAccount.status).toBe('ok')
    expect(await on()).toBeNull()
    expect(await enabled()).toBe(true)
    // While on, a save without code.portal is refused and the saved account stays.
    expect((await run<{ saveWhatsAppAccount: Result }>(save, caller, { ...input, ...withoutCode })).data?.saveWhatsAppAccount).toMatchObject({ ok: false, reason: 'NO_CODE_TEMPLATE' })
    expect((await run<Read>(read, caller)).data?.whatsAppAccount.account?.templates[0]).toEqual({ message: 'code.portal', name: 'portal_code' })
    // A test Meta rejects while on turns WhatsApp off in the same transaction, audited.
    metaAnswers = { phone: 200, templateStatus: 'REJECTED' }
    expect((await run<{ testWhatsAppAccount: Result }>(test, caller)).data?.testWhatsAppAccount).toMatchObject({ ok: true, status: 'rejected', problem: 'template' })
    metaAnswers = { phone: 200, templateStatus: 'APPROVED' }
    expect(await enabled()).toBe(false)
    const [entry] = await db.sql<{ reason: string | null }[]>`select reason from activity_log where partner_id = ${ids.fresh} and action = 'partner.whatsapp_disabled'`
    expect(entry?.reason).toBe('test_rejected')
    await run(remove, caller)
  })

  it('audits every write without the token', async () => {
    const rows = await db.sql<{ action: string; entry: string }[]>`select action, row_to_json(activity_log)::text as entry from activity_log where action like 'partner.whatsapp%'`
    expect(new Set(rows.map((r) => r.action))).toEqual(new Set(['partner.whatsapp_account_saved', 'partner.whatsapp_account_tested', 'partner.whatsapp_enabled', 'partner.whatsapp_disabled', 'partner.whatsapp_account_removed']))
    for (const r of rows) expect(r.entry).not.toContain(token)
  })
})

describe('who may', () => {
  it('lets Owner, Admin and a setup session manage WhatsApp, and refuses Support, Finance and Read-only every field', async () => {
    for (const [role, staff, ok] of [['partner-owner', false, true], ['partner-admin', false, true], ['partner-owner', true, true], ['partner-support', false, false], ['partner-finance', false, false], ['partner-read-only', false, false]] as const) {
      const caller = callerOf(ids.kl, role, staff)
      const results = [await run(read, caller), await run(save, caller, input), await run(test, caller), await run(setEnabled, caller, { enabled: false }), await run(remove, caller)]
      for (const r of results) {
        expect(r.code, `${role}${staff ? ' setup' : ''}`).toBe(ok ? undefined : 'FORBIDDEN')
        expect(r.text).not.toContain(token)
      }
    }
  })

  it('refuses every WhatsApp field to an impersonation', async () => {
    const imp = callerOf(ids.ns, 'partner-owner', false, true)
    for (const [source, variables] of [[read, {}], [save, input], [test, {}], [remove, {}], [setEnabled, { enabled: false }]] as const) {
      expect((await run(source, imp, variables)).code).toBe('BLOCKED_WHILE_IMPERSONATING')
    }
  })
})

describe('isolation between partners', () => {
  it('never shows, tests, turns on or removes another partner’s account', async () => {
    const other = callerOf(ids.fresh, 'partner-owner')
    expect((await run<Read>(read, other)).data?.whatsAppAccount).toEqual({ enabled: false, account: null })
    expect((await run<{ testWhatsAppAccount: Result }>(test, other)).data?.testWhatsAppAccount.reason).toBe('NOT_FOUND')
    expect((await run<{ setWhatsAppEnabled: Result }>(setEnabled, other, { enabled: true })).data?.setWhatsAppEnabled.reason).toBe('NO_ACCOUNT')
    expect((await run<{ removeWhatsAppAccount: Result }>(remove, other)).data?.removeWhatsAppAccount.reason).toBe('NOT_FOUND')
    expect((await db.sql`select 1 from partner_credential where partner_id = ${ids.ns} and kind = 'whatsapp'`).length).toBe(1)
  })

  it('keeps the sealed token from every console role', async () => {
    for (const role of ['app_partner', 'app_platform', 'app_request']) {
      await expect(
        db.sql.begin(async (tx) => {
          await tx.unsafe(`set local role ${role}`)
          await tx`select key_enc from partner_credential where kind = 'whatsapp'`
        }),
      ).rejects.toThrow(/permission denied/)
    }
  })

  it('reads each partner’s own account for its messages, none while it is off or missing, and sends through it with its token', async () => {
    const accounts = whatsappAccountsFor(box, async () => null)
    const forPartner = (partnerId: string) => withSystemScope(db.sql, (tx) => accounts.forPartner(tx, partnerId))
    expect(await forPartner(ids.ns)).toMatchObject({ accessToken: token, phoneNumberId: input.phoneNumberId, templates: { 'cart.reminder': 'cart_reminder' } })
    expect(await forPartner(ids.fresh)).toBeNull()
    expect(await forPartner(ids.kl)).toBeNull()
    await db.sql`update partner set whatsapp_enabled = false where id = ${ids.ns}`
    expect(await forPartner(ids.ns)).toBeNull()
    await db.sql`update partner set whatsapp_enabled = true where id = ${ids.ns}`
    // A sealed token that can't be opened sends nothing rather than half sending.
    await db.sql`insert into partner_credential (partner_id, kind, provider, name, key_enc, key_prefix, settings, created_by) select ${ids.fresh}, kind, provider, name, 'v1.broken.broken', key_prefix, settings, 'test' from partner_credential where partner_id = ${ids.ns} and kind = 'whatsapp'`
    await db.sql`update partner set whatsapp_enabled = true where id = ${ids.fresh}`
    expect(await forPartner(ids.fresh)).toBeNull()
    await db.sql`delete from partner_credential where partner_id = ${ids.fresh}`
    await db.sql`update partner set whatsapp_enabled = false where id = ${ids.fresh}`

    const account = await forPartner(ids.ns)
    if (!account) throw new Error('no account')
    const seen: Request[] = []
    const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => (seen.push(new Request(url, init)), new Response(JSON.stringify({ messages: [{ id: 'wamid.9' }] }), { status: 200 }))) as typeof fetch
    await metaWhatsAppSender({ ...account, fetchImpl }).send({ to: '+919811122233', template: 'cart_reminder', language: 'en', vars: ['Jaipur', '2 items', 'https://jaipur.shop.example/cart/r/x'] })
    expect(seen[0]?.url).toContain(`/${input.phoneNumberId}/messages`)
    expect(seen[0]?.headers.get('authorization')).toBe(`Bearer ${token}`)
  })
})
