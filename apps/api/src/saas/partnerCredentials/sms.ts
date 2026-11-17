import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import {
  awsSecretAccessKeySchema,
  msg91AuthKeySchema,
  routeProviders,
  smsMessages,
  smsProviders,
  smsRoutes,
  twilioAccountSidSchema,
  twilioAuthTokenSchema,
  twilioMessagingServiceSidSchema,
  type SmsAccountCheck,
  type SmsProvider,
  type SmsRoute,
} from '#core/sms'
import type { PartnerSmsAccountRow } from '#db/schema/saas'
import { serialise, withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { deleteSmsAccount, insertSmsAccount, selectSealedSmsAccount, selectSmsAccount, selectSmsAccounts, selectSmsPrefs, updateSmsAccount, updateSmsAccountTest, updateSmsEnabled, updateSmsRoute } from '#db/scoped/partnerCredentials'
import { selectDfMessaging } from '#db/scoped/platformMessaging'
import { partnerEntry } from '#saas/activity/index'
import { accountForRoute, openSmsAccount, savedServes, senderOf, smsSettingsSchemas, type OurSms, type PartnerSmsAccount } from '#saas/sms/index'

// Settings › Integrations, SMS (#1017; THIRD-PARTY-ACCESS §4, §8.3): the partner's own MSG91, Twilio and SNS accounts, the
// provider for each route, which replaces DripFunnel's once complete, and its SMS switch. A secret is sealed on the way in
// and shown back as its last four only.

export const smsAudit = {
  save: 'partner.sms_account_saved',
  test: 'partner.sms_account_tested',
  remove: 'partner.sms_account_removed',
  route: 'partner.sms_route_set',
  enabled: 'partner.sms_enabled',
  disabled: 'partner.sms_disabled',
} as const

const templateInput = z.strictObject({ message: z.string(), templateId: z.string().trim() })
const templatesInput = z.array(templateInput).max(smsMessages.length)
const saveInput = z.discriminatedUnion('provider', [
  z.strictObject({ provider: z.literal('msg91'), authKey: z.string().trim(), templates: templatesInput }),
  z.strictObject({ provider: z.literal('twilio'), accountSid: z.string().trim(), authToken: z.string().trim(), messagingServiceSid: z.string().trim() }),
  z.strictObject({
    provider: z.literal('sns'),
    accessKeyId: z.string().trim(),
    secretAccessKey: z.string().trim(),
    region: z.string().trim(),
    senderId: z.string().trim().optional(),
    entityId: z.string().trim().optional(),
    templates: templatesInput.optional(),
  }),
])

export type SmsAccountRefusal = 'INVALID_INPUT' | 'TEMPLATES_INCOMPLETE' | 'ACCOUNT_INCOMPLETE' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'DRIPFUNNEL_UNAVAILABLE'

export const smsProviderName: Record<SmsProvider, string> = { msg91: 'MSG91', twilio: 'Twilio', sns: 'AWS SNS' }
export const hintOf = (secret: string) => `…${secret.slice(-4)}`

type Parsed = { ok: true; account: PartnerSmsAccount; secret: string; settings: Record<string, unknown> } | { ok: false; reason: SmsAccountRefusal }
type TemplatesParsed = { ok: true; templates: Record<string, string> } | { ok: false; reason: SmsAccountRefusal }

/** India's seven template ids, all or refused (#1017), so an account never half serves the route. */
const parseTemplates = (given: z.infer<typeof templatesInput>): TemplatesParsed => {
  if (given.some((t) => !(smsMessages as readonly string[]).includes(t.message))) return { ok: false, reason: 'INVALID_INPUT' }
  const templates = Object.fromEntries(given.filter((t) => t.templateId !== '').map((t) => [t.message, t.templateId]))
  return smsMessages.every((m) => templates[m]) ? { ok: true, templates } : { ok: false, reason: 'TEMPLATES_INCOMPLETE' }
}

/** An account as typed, checked against its provider's shape; DripFunnel's own are typed the same way (#1543). */
export const parseSmsAccount = (raw: unknown): Parsed => {
  const parsed = saveInput.safeParse(raw)
  if (!parsed.success) return { ok: false, reason: 'INVALID_INPUT' }
  const input = parsed.data
  if (input.provider === 'msg91') {
    const authKey = msg91AuthKeySchema.safeParse(input.authKey)
    if (!authKey.success) return { ok: false, reason: 'INVALID_INPUT' }
    const templates = parseTemplates(input.templates)
    if (!templates.ok) return templates
    const settings = smsSettingsSchemas.msg91.safeParse({ templates: templates.templates })
    if (!settings.success) return { ok: false, reason: 'INVALID_INPUT' }
    return { ok: true, account: { provider: 'msg91', authKey: authKey.data, templates: settings.data.templates }, secret: authKey.data, settings: settings.data }
  }
  if (input.provider === 'twilio') {
    const sid = twilioAccountSidSchema.safeParse(input.accountSid)
    const token = twilioAuthTokenSchema.safeParse(input.authToken)
    const service = twilioMessagingServiceSidSchema.safeParse(input.messagingServiceSid)
    if (!sid.success || !token.success || !service.success) return { ok: false, reason: 'INVALID_INPUT' }
    const settings = { accountSid: sid.data, messagingServiceSid: service.data }
    return { ok: true, account: { provider: 'twilio', authToken: token.data, ...settings }, secret: token.data, settings }
  }
  const secret = awsSecretAccessKeySchema.safeParse(input.secretAccessKey)
  if (!secret.success) return { ok: false, reason: 'INVALID_INPUT' }
  // India's part (the DLT header, entity and seven templates) is all or none: without it the account serves `rest` only.
  const wantsIndia = Boolean(input.senderId || input.entityId || input.templates?.some((t) => t.templateId !== ''))
  const templates = wantsIndia ? parseTemplates(input.templates ?? []) : null
  if (templates && !templates.ok) return templates
  const india = templates ? { senderId: input.senderId, entityId: input.entityId, templates: templates.templates } : null
  const settings = smsSettingsSchemas.sns.safeParse({ accessKeyId: input.accessKeyId, region: input.region, india })
  if (!settings.success) return { ok: false, reason: 'INVALID_INPUT' }
  return { ok: true, account: { provider: 'sns', secretAccessKey: secret.data, ...settings.data }, secret: secret.data, settings: settings.data }
}

export interface PartnerSmsDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  /** One read-only call to the provider: nothing is sent. */
  checkSms: (account: PartnerSmsAccount) => Promise<SmsAccountCheck>
  /** DripFunnel's routes this partner may use (#1543), as the deliverer reads them. */
  ourSms: OurSms
  now: () => Date
}

/** What an account shows back, a partner's or DripFunnel's: never its secret. */
export const smsAccountDto = (r: Pick<PartnerSmsAccountRow, 'provider' | 'key_prefix' | 'status' | 'last_tested_at' | 'settings'>) => ({
  provider: r.provider,
  hint: r.key_prefix,
  status: r.status,
  lastTestedAt: r.last_tested_at,
  // India's seven templates; Twilio has none.
  templatesComplete: r.provider === 'twilio' ? null : savedServes(r, 'india'),
})

export const createPartnerSmsService = ({ sql, caller, facts, activity, secrets, checkSms, ourSms, now }: PartnerSmsDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const targetOf = (provider: SmsProvider) => ({ type: 'sms_account', id: `${partnerId}:${provider}`, label: smsProviderName[provider] })
  const lock = (tx: ScopedSql, provider: SmsProvider) => serialise(tx, `partner_sms:${partnerId}:${provider}`)
  const isProvider = (value: string): value is SmsProvider => (smsProviders as readonly string[]).includes(value)

  // DripFunnel's routes are read in system scope, as the deliverer reads them; only whether each is there leaves it.
  const oursServes = () => withSystemScope(sql, async (tx) => ourSms(tx, partnerId))

  /** Per route, the partner's choice, whether DripFunnel's serves it for this partner, and whose account sends (#1543). */
  const accounts = async () => {
    const ours = await oursServes()
    return withScope(sql, context, async (tx) => {
      const prefs = await selectSmsPrefs(tx, partnerId)
      const rows = await selectSmsAccounts(tx, partnerId)
      const routes = smsRoutes.map((route) => {
        const choice = prefs.routes[route]
        return { route, provider: choice, dripfunnel: ours[route] !== undefined, sender: senderOf(choice, accountForRoute(rows, route, choice) !== undefined, ours[route] !== undefined) }
      })
      return { enabled: prefs.enabled, dripfunnel: (await selectDfMessaging(tx, partnerId)).sms, routes, accounts: rows.map(smsAccountDto) }
    })
  }

  type Result = { ok: true; status?: 'ok' | 'rejected' } | { ok: false; reason: SmsAccountRefusal }

  const save = async (raw: unknown): Promise<Result> => {
    const parsed = parseSmsAccount(raw)
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
      else await insertSmsAccount(tx, { ...write, partnerId, provider: account.provider, name: smsProviderName[account.provider], createdBy: actingName(caller) })
      await activity.record(tx, entry({ action: smsAudit.save, target: targetOf(account.provider), reason: before ? 'replaced' : null, changes: [{ field: 'provider', before: before ? account.provider : null, after: account.provider }] }))
      return { ok: true, status: 'ok' }
    })
  }

  const test = async (provider: string): Promise<Result> => {
    if (!isProvider(provider)) return { ok: false, reason: 'NOT_FOUND' }
    // The sealed secret is system-scope only, so the console path never holds it: the check reads it in its own scope.
    const sealed = await withSystemScope(sql, (tx) => selectSealedSmsAccount(tx, partnerId, provider))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    const account = await openSmsAccount(secrets, { provider, ...sealed })
    if (!account) return { ok: false, reason: 'NOT_CONFIGURED' }
    const checked = await checkSms(account)
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    return withScope(sql, context, async (tx): Promise<Result> => {
      const row = await selectSmsAccount(tx, partnerId, provider)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateSmsAccountTest(tx, row.id, checked, now())
      await activity.record(tx, entry({ action: smsAudit.test, target: targetOf(provider), reason: null, changes: [{ field: 'status', before: row.status, after: checked }] }))
      return { ok: true, status: checked }
    })
  }

  const remove = (provider: string): Promise<Result> => {
    if (!isProvider(provider)) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx, provider)
      const row = await selectSmsAccount(tx, partnerId, provider)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await deleteSmsAccount(tx, row.id)
      await activity.record(tx, entry({ action: smsAudit.remove, target: targetOf(provider), reason: null }))
      return { ok: true }
    })
  }

  /**
   * Which saved account serves a route, or `dripfunnel` where Admin enabled DripFunnel's and it serves the route (#1543);
   * null hands it back to the first of the route's providers the partner holds.
   */
  const setRoute = async (route: string, provider: string | null): Promise<Result> => {
    const which = smsRoutes.find((r) => r === route)
    if (!which || (provider !== null && provider !== 'dripfunnel' && !(routeProviders[which] as readonly string[]).includes(provider))) return { ok: false, reason: 'INVALID_INPUT' }
    if (provider === 'dripfunnel' && (await oursServes())[which] === undefined) return { ok: false, reason: 'DRIPFUNNEL_UNAVAILABLE' }
    return withScope(sql, context, async (tx): Promise<Result> => {
      await serialise(tx, `partner_sms:${partnerId}`)
      const chosen = provider === 'dripfunnel' ? provider : provider !== null && isProvider(provider) ? provider : null
      if (chosen && chosen !== 'dripfunnel') {
        const row = await selectSmsAccount(tx, partnerId, chosen)
        if (!row || !savedServes(row, which)) return { ok: false, reason: 'ACCOUNT_INCOMPLETE' }
      }
      const before = (await selectSmsPrefs(tx, partnerId)).routes[which]
      if (before === chosen) return { ok: true }
      await updateSmsRoute(tx, partnerId, which, chosen)
      await activity.record(tx, entry({ action: smsAudit.route, target: { type: 'sms', id: partnerId, label: 'SMS' }, reason: which, changes: [{ field: `route_${which}`, before, after: chosen }] }))
      return { ok: true }
    })
  }

  /** Off sends the partner's stores no text through any account, DripFunnel's included (THIRD-PARTY-ACCESS §4). */
  const setEnabled = (enabled: boolean): Promise<Result> =>
    withScope(sql, context, async (tx): Promise<Result> => {
      await serialise(tx, `partner_sms:${partnerId}`)
      const before = (await selectSmsPrefs(tx, partnerId)).enabled
      if (before === enabled) return { ok: true }
      await updateSmsEnabled(tx, partnerId, enabled)
      await activity.record(tx, entry({ action: enabled ? smsAudit.enabled : smsAudit.disabled, target: { type: 'sms', id: partnerId, label: 'SMS' }, reason: null, changes: [{ field: 'sms_enabled', before, after: enabled }] }))
      return { ok: true }
    })

  return { accounts, save, test, remove, setRoute, setEnabled }
}

export type PartnerSmsService = ReturnType<typeof createPartnerSmsService>
