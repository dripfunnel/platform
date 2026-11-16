import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import { msg91AuthKeySchema, smsMessages, smsProviders, twilioAccountSidSchema, twilioAuthTokenSchema, twilioMessagingServiceSidSchema, type SmsAccountCheck, type SmsProvider } from '#core/sms'
import type { PartnerSmsAccountRow } from '#db/schema/saas'
import { serialise, withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { deleteSmsAccount, insertSmsAccount, selectSealedSmsAccount, selectSmsAccount, selectSmsAccounts, selectSmsEnabled, updateSmsAccount, updateSmsAccountTest, updateSmsEnabled } from '#db/scoped/partnerCredentials'
import { partnerEntry } from '#saas/activity/index'
import { smsSettingsSchemas, type PartnerSmsAccount } from '#saas/sms/index'

// Settings › Integrations, SMS (#1017; THIRD-PARTY-ACCESS §4, §8.3): the partner's own MSG91 and Twilio accounts, which replace
// DripFunnel's once complete, and its SMS switch. The secret is sealed on the way in and shown back as its last four only.

export const smsAudit = {
  save: 'partner.sms_account_saved',
  test: 'partner.sms_account_tested',
  remove: 'partner.sms_account_removed',
  enabled: 'partner.sms_enabled',
  disabled: 'partner.sms_disabled',
} as const

const templateInput = z.strictObject({ message: z.string(), templateId: z.string().trim() })
const saveInput = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('msg91'), authKey: z.string().trim(), templates: z.array(templateInput).max(smsMessages.length) }),
  z.strictObject({ provider: z.literal('twilio'), accountSid: z.string().trim(), authToken: z.string().trim(), messagingServiceSid: z.string().trim() }),
])

export type SmsAccountRefusal = 'INVALID_INPUT' | 'TEMPLATES_INCOMPLETE' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND'

const providerName: Record<SmsProvider, string> = { msg91: 'MSG91', twilio: 'Twilio' }
const hintOf = (secret: string) => `…${secret.slice(-4)}`

type Parsed = { ok: true; account: PartnerSmsAccount; secret: string; settings: Record<string, unknown> } | { ok: false; reason: SmsAccountRefusal }

/** An MSG91 account needs every message's template id (#1017), so a partner's account is never half used. */
const parseSave = (raw: unknown): Parsed => {
  const parsed = saveInput.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
  const input = parsed.data
  if (input.provider === 'msg91') {
    const authKey = msg91AuthKeySchema.safeParse(input.authKey)
    const templates = Object.fromEntries(input.templates.filter((t) => t.templateId !== '').map((t) => [t.message, t.templateId]))
    if (!authKey.success || input.templates.some((t) => !(smsMessages as readonly string[]).includes(t.message))) return { ok: false, reason: 'INVALID_INPUT' }
    if (smsMessages.some((m) => !templates[m])) return { ok: false, reason: 'TEMPLATES_INCOMPLETE' }
    const settings = smsSettingsSchemas.msg91.safeParse({ templates })
    if (!settings.success) return { ok: false, reason: 'INVALID_INPUT' }
    return { ok: true, account: { provider: 'msg91', authKey: authKey.data, templates: settings.data.templates }, secret: authKey.data, settings: settings.data }
  }
  const sid = twilioAccountSidSchema.safeParse(input.accountSid)
  const token = twilioAuthTokenSchema.safeParse(input.authToken)
  const service = twilioMessagingServiceSidSchema.safeParse(input.messagingServiceSid)
  if (!sid.success || !token.success || !service.success) return { ok: false, reason: 'INVALID_INPUT' }
  const settings = { accountSid: sid.data, messagingServiceSid: service.data }
  return { ok: true, account: { provider: 'twilio', authToken: token.data, ...settings }, secret: token.data, settings }
}

/** What a check needs of a stored account: MSG91's key alone, Twilio's key with both SIDs. */
const checkableAccount = (provider: SmsProvider, secret: string, stored: unknown): PartnerSmsAccount | null => {
  if (provider === 'msg91') return { provider, authKey: secret, templates: {} }
  const settings = smsSettingsSchemas.twilio.safeParse(stored)
  return settings.success ? { provider, authToken: secret, ...settings.data } : null
}

export interface PartnerSmsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  /** One read-only call to the provider: nothing is sent. */
  checkSms: (account: PartnerSmsAccount) => Promise<SmsAccountCheck>
  now: () => Date
}

const dto = (r: PartnerSmsAccountRow) => ({
  provider: r.provider,
  hint: r.key_prefix,
  status: r.status,
  lastTestedAt: r.last_tested_at,
  // Twilio has no templates to complete.
  templatesComplete: r.provider === 'msg91' ? smsSettingsSchemas.msg91.safeParse(r.settings).success : null,
})

export const createPartnerSmsService = ({ sql, caller, facts, activity, secrets, checkSms, now }: PartnerSmsDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const targetOf = (provider: SmsProvider) => ({ type: 'sms_account', id: `${partnerId}:${provider}`, label: providerName[provider] })
  const lock = (tx: ScopedSql, provider: SmsProvider) => serialise(tx, `partner_sms:${partnerId}:${provider}`)

  const accounts = () =>
    withScope(sql, context, async (tx) => ({ enabled: await selectSmsEnabled(tx, partnerId), accounts: (await selectSmsAccounts(tx, partnerId)).map(dto) }))

  type Result = { ok: true; status?: 'ok' | 'rejected' } | { ok: false; reason: SmsAccountRefusal }

  const save = async (raw: unknown): Promise<Result> => {
    const parsed = parseSave(raw)
    if (!parsed.ok) return parsed
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const { account, secret, settings } = parsed
    const checked = await checkSms(account)
    if (checked === 'rejected') return { ok: false, reason: 'KEY_REJECTED' }
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    const keyEnc = await secrets.seal(secret)
    const at = now()
    const write = { keyEnc, keyPrefix: hintOf(secret), settings, status: 'ok' as const, testedAt: at, at }
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx, account.provider)
      const before = await selectSmsAccount(tx, partnerId, account.provider)
      if (before) await updateSmsAccount(tx, before.id, write)
      else await insertSmsAccount(tx, { ...write, partnerId, provider: account.provider, name: providerName[account.provider], createdBy: actingName(caller) })
      await activity.record(tx, entry({ action: smsAudit.save, target: targetOf(account.provider), reason: before ? 'replaced' : null, changes: [{ field: 'provider', before: before ? account.provider : null, after: account.provider }] }))
      return { ok: true, status: 'ok' }
    })
  }

  const test = async (provider: string): Promise<Result> => {
    if (!(smsProviders as readonly string[]).includes(provider)) return { ok: false, reason: 'NOT_FOUND' }
    const which = provider as SmsProvider
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    // The sealed secret is system-scope only, so the console path never holds it: the check reads it in its own scope.
    const sealed = await withSystemScope(sql, (tx) => selectSealedSmsAccount(tx, partnerId, which))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    const secret = await secrets.open(sealed.key_enc)
    if (!secret) return { ok: false, reason: 'NOT_CONFIGURED' }
    const account = checkableAccount(which, secret, sealed.settings)
    const checked: SmsAccountCheck = account ? await checkSms(account) : 'rejected'
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    return withScope(sql, context, async (tx): Promise<Result> => {
      const row = await selectSmsAccount(tx, partnerId, which)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateSmsAccountTest(tx, row.id, checked, now())
      await activity.record(tx, entry({ action: smsAudit.test, target: targetOf(which), reason: null, changes: [{ field: 'status', before: row.status, after: checked }] }))
      return { ok: true, status: checked }
    })
  }

  const remove = (provider: string): Promise<Result> => {
    if (!(smsProviders as readonly string[]).includes(provider)) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    const which = provider as SmsProvider
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx, which)
      const row = await selectSmsAccount(tx, partnerId, which)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await deleteSmsAccount(tx, row.id)
      await activity.record(tx, entry({ action: smsAudit.remove, target: targetOf(which), reason: null }))
      return { ok: true }
    })
  }

  /** Off sends the partner's stores no text through any account, DripFunnel's included (THIRD-PARTY-ACCESS §4). */
  const setEnabled = (enabled: boolean): Promise<Result> =>
    withScope(sql, context, async (tx): Promise<Result> => {
      await serialise(tx, `partner_sms:${partnerId}`)
      const before = await selectSmsEnabled(tx, partnerId)
      if (before === enabled) return { ok: true }
      await updateSmsEnabled(tx, partnerId, enabled)
      await activity.record(tx, entry({ action: enabled ? smsAudit.enabled : smsAudit.disabled, target: { type: 'sms', id: partnerId, label: 'SMS' }, reason: null, changes: [{ field: 'sms_enabled', before, after: enabled }] }))
      return { ok: true }
    })

  return { accounts, save, test, remove, setEnabled }
}

export type PartnerSmsService = ReturnType<typeof createPartnerSmsService>
