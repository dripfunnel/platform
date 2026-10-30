import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import { msg91AuthKey, msg91Templates, smsMessages, smsProviders, twilioAccountSid, twilioAuthToken, twilioMessagingServiceSid, type SmsAccountCheck, type SmsMessage, type SmsProvider } from '#core/sms'
import { serialise, withScope, withSystemScope } from '#db/scoped/index'
import { deleteSmsAccount, insertSmsAccount, selectSealedSmsAccount, selectSmsAccount, selectSmsAccounts, updateSmsAccountTest } from '#db/scoped/partnerSmsCredentials'
import type { TwilioCredentials } from '#integrations/twilio/index'
import { partnerEntry } from '#saas/activity/index'
import { partnerAccountOf } from '#saas/sms/index'

// Settings › Integrations, SMS accounts (card #1017; the screen is #1018). A partner's own MSG91 or Twilio account replaces
// DripFunnel's for that provider once complete. The secret is sealed on the way in and never read back: the console sees
// its last four characters.

export const smsAudit = {
  saved: 'partner.sms_account_saved',
  tested: 'partner.sms_account_tested',
  removed: 'partner.sms_account_removed',
} as const

export type SmsRefusal = 'INVALID_INPUT' | 'TEMPLATES_INCOMPLETE' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'PROVIDER_UNAVAILABLE'

/** Asks a provider whether an account works, sending nothing; `unavailable` leaves the saved status as it was. */
export interface SmsAccountCheckers {
  msg91: (input: { authKey: string; templateId: string }) => Promise<SmsAccountCheck>
  twilio: (credentials: TwilioCredentials) => Promise<SmsAccountCheck>
}

export interface SmsAccountsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  /** Null where the Worker has no check: a test is then refused as not configured. */
  checkSms: SmsAccountCheckers | null
  now: () => Date
}

const templateEntry = z.strictObject({ message: z.enum(smsMessages), templateId: z.string() })
const saveInput = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('msg91'), authKey: msg91AuthKey, templates: z.array(templateEntry).max(smsMessages.length) }),
  z.strictObject({ provider: z.literal('twilio'), accountSid: twilioAccountSid, authToken: twilioAuthToken, messagingServiceSid: twilioMessagingServiceSid }),
])

const label: Record<SmsProvider, string> = { msg91: 'MSG91', twilio: 'Twilio' }

// What the console shows of a secret: enough to tell two accounts apart, never enough to use one.
const hintOf = (secret: string): string => `…${secret.slice(-4)}`

export const createSmsAccountsService = ({ sql, caller, facts, activity, secrets, checkSms, now }: SmsAccountsDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const madeBy = actingName(caller)

  const smsAccounts = () =>
    withScope(sql, context, async (tx) =>
      (await selectSmsAccounts(tx, partnerId)).map((r) => ({
        provider: r.provider,
        hint: r.key_prefix,
        status: r.status,
        lastTestedAt: r.last_tested_at,
        // Only MSG91 has templates; Twilio is whole once it is saved.
        templatesComplete: r.provider === 'msg91' ? msg91Templates.safeParse((r.settings as { templates?: unknown }).templates).success : null,
      })),
    )

  type SaveResult = { ok: true } | { ok: false; reason: SmsRefusal }

  const saveSmsAccount = async (raw: unknown): Promise<SaveResult> => {
    const parsed = saveInput.safeParse(raw)
    if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
    const input = parsed.data
    let secret: string
    let settings: Record<string, unknown>
    if (input.provider === 'msg91') {
      const byMessage = new Map<SmsMessage, string>()
      for (const { message, templateId } of input.templates) {
        if (byMessage.has(message)) return { ok: false, reason: 'INVALID_INPUT' }
        byMessage.set(message, templateId)
      }
      // All seven or nothing: an MSG91 account that misses one would send some texts and drop the rest.
      if (smsMessages.some((m) => !byMessage.has(m))) return { ok: false, reason: 'TEMPLATES_INCOMPLETE' }
      const templates = msg91Templates.safeParse(Object.fromEntries(byMessage))
      if (!templates.success) return { ok: false, reason: 'INVALID_INPUT' }
      secret = input.authKey
      settings = { templates: templates.data }
    } else {
      secret = input.authToken
      settings = { accountSid: input.accountSid, messagingServiceSid: input.messagingServiceSid }
    }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const keyEnc = await secrets.seal(secret)
    const { provider } = input
    return withScope(sql, context, async (tx): Promise<SaveResult> => {
      await serialise(tx, `partner_sms:${partnerId}`)
      const existing = await selectSmsAccount(tx, partnerId, provider)
      if (existing) await deleteSmsAccount(tx, existing.id)
      const id = await insertSmsAccount(tx, { partnerId, provider, keyEnc, keyPrefix: hintOf(secret), settings, createdBy: madeBy })
      await activity.record(tx, entry({ action: smsAudit.saved, target: { type: 'sms_account', id, label: label[provider] }, reason: null, changes: [{ field: 'provider', before: existing ? provider : null, after: provider }] }))
      return { ok: true }
    })
  }

  type TestResult = { ok: true; status: 'ok' | 'rejected' } | { ok: false; reason: SmsRefusal }

  const testSmsAccount = async (provider: string): Promise<TestResult> => {
    const known = z.enum(smsProviders).safeParse(provider)
    if (!known.success) return { ok: false, reason: 'NOT_FOUND' }
    if (!secrets || !checkSms) return { ok: false, reason: 'NOT_CONFIGURED' }
    // The sealed secret is system scope only, so the console path never holds it: the check reads it in its own scope.
    const sealed = await withSystemScope(sql, (tx) => selectSealedSmsAccount(tx, partnerId, known.data))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    const secret = await secrets.open(sealed.key_enc)
    const account = secret ? partnerAccountOf(known.data, secret, sealed.settings) : null
    if (!account) return { ok: false, reason: 'NOT_CONFIGURED' }
    const templateId = account.provider === 'msg91' ? account.templates['code.second_factor'] : undefined
    const checked = account.provider === 'msg91' ? (templateId ? await checkSms.msg91({ authKey: account.authKey, templateId }) : 'unavailable') : await checkSms.twilio(account)
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    return withScope(sql, context, async (tx): Promise<TestResult> => {
      const row = await selectSmsAccount(tx, partnerId, known.data)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateSmsAccountTest(tx, row.id, checked, now())
      await activity.record(tx, entry({ action: smsAudit.tested, target: { type: 'sms_account', id: row.id, label: label[known.data] }, reason: null, changes: [{ field: 'status', before: row.status, after: checked }] }))
      return { ok: true, status: checked }
    })
  }

  const removeSmsAccount = (provider: string): Promise<SaveResult> => {
    const known = z.enum(smsProviders).safeParse(provider)
    if (!known.success) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return withScope(sql, context, async (tx): Promise<SaveResult> => {
      await serialise(tx, `partner_sms:${partnerId}`)
      const row = await selectSmsAccount(tx, partnerId, known.data)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await deleteSmsAccount(tx, row.id)
      await activity.record(tx, entry({ action: smsAudit.removed, target: { type: 'sms_account', id: row.id, label: label[known.data] }, reason: null }))
      return { ok: true }
    })
  }

  return { smsAccounts, saveSmsAccount, testSmsAccount, removeSmsAccount }
}
