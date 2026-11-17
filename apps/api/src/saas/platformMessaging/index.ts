import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import type { StaffMember } from '#auth/staff'
import { isUuid } from '#core/ids'
import { routeProviders, smsProviders, smsRoutes, type SmsAccountCheck, type SmsProvider } from '#core/sms'
import type { WhatsAppAccountCheck } from '#core/whatsapp'
import { serialise, withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  deleteOurAccount,
  selectDfMessaging,
  selectOurAccount,
  selectOurAccounts,
  selectOurMessaging,
  updateDfMessaging,
  updateOurAccountTest,
  updateOurSmsRoute,
  updateOurWhatsAppEnabled,
  upsertOurAccount,
  type MessagingKind,
  type OurAccountRow,
} from '#db/scoped/platformMessaging'
import {
  hintOf,
  parseSmsAccount,
  parseWhatsAppAccount,
  servesCodes,
  smsAccountDto,
  smsProviderName,
  whatsappAccountDto,
  whatsappProblemOf,
  type SmsAccountRefusal,
  type WhatsAppAccountRefusal,
} from '#saas/partnerCredentials/index'
import { accountForRoute, openSmsAccount, savedServes, type PartnerSmsAccount } from '#saas/sms/index'
import { reasonText, staffEntry } from '#saas/staff/index'
import { openWhatsAppAccount, type PartnerWhatsAppAccount } from '#saas/whatsapp/index'

// DripFunnel's own SMS and WhatsApp accounts in the admin console, and the per-partner switches that let a partner use them
// (#1543; THIRD-PARTY-ACCESS §4). The accounts are `platform_credential` rows, every column app_system's alone, so each
// read and write runs in system scope with the staff member as the actor; the API's permissions decide who reaches it.

export const platformMessagingAudit = {
  smsSave: 'platform.sms_account_saved',
  smsTest: 'platform.sms_account_tested',
  smsRemove: 'platform.sms_account_removed',
  smsRoute: 'platform.sms_route_set',
  whatsappSave: 'platform.whatsapp_account_saved',
  whatsappTest: 'platform.whatsapp_account_tested',
  whatsappRemove: 'platform.whatsapp_account_removed',
  whatsappEnabled: 'platform.whatsapp_enabled',
  whatsappDisabled: 'platform.whatsapp_disabled',
  partnerSmsEnabled: 'partner.df_sms_enabled',
  partnerSmsDisabled: 'partner.df_sms_disabled',
  partnerWhatsAppEnabled: 'partner.df_whatsapp_enabled',
  partnerWhatsAppDisabled: 'partner.df_whatsapp_disabled',
} as const

export type MessagingRefusal = SmsAccountRefusal | WhatsAppAccountRefusal
type Problem = ReturnType<typeof whatsappProblemOf>
export type MessagingResult = ({ ok: true; status?: 'ok' | 'rejected' } & Problem) | ({ ok: false; reason: MessagingRefusal } & Problem)

export interface PlatformMessagingDeps {
  sql: postgres.Sql
  staff: StaffMember
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  checkSms: (account: PartnerSmsAccount) => Promise<SmsAccountCheck>
  checkWhatsApp: (account: PartnerWhatsAppAccount) => Promise<WhatsAppAccountCheck>
  now: () => Date
}

const isSmsRow = (row: OurAccountRow): row is OurAccountRow & { provider: SmsProvider } => (smsProviders as readonly string[]).includes(row.provider)
const isProvider = (value: string): value is SmsProvider => (smsProviders as readonly string[]).includes(value)
const channels: readonly MessagingKind[] = ['sms', 'whatsapp']

export const createPlatformMessagingService = ({ sql, staff, facts, activity, secrets, checkSms, checkWhatsApp, now }: PlatformMessagingDeps) => {
  const entry = staffEntry(staff, facts)
  const madeBy = `${staff.name} <${staff.email}>`
  const smsTarget = (provider: SmsProvider) => ({ type: 'platform_sms_account', id: provider, label: smsProviderName[provider] })
  const whatsappTarget = { type: 'platform_whatsapp_account', id: 'meta', label: 'WhatsApp' }
  const record = (tx: ScopedSql, action: string, target: { type: string; id: string; label: string }, reason: string | null, changes: { field: string; before: unknown; after: unknown }[] = []) =>
    activity.record(tx, entry({ action, target, reason, changes, visibility: 'staff' }))

  /** Every staff role sees this (ACCESS §5.4): provider, last four, Working or Rejected, last check, routes; never a secret. */
  const smsAccounts = () =>
    withSystemScope(sql, async (tx) => {
      const rows = (await selectOurAccounts(tx, 'sms')).filter(isSmsRow)
      const { routes } = await selectOurMessaging(tx)
      return {
        accounts: rows.map(smsAccountDto),
        // `provider` is the choice; `serving` the account that sends the route's texts, if any does.
        routes: smsRoutes.map((route) => ({ route, provider: routes[route], serving: accountForRoute(rows, route, routes[route])?.provider ?? null })),
      }
    })

  const saveSms = async (raw: unknown, reason: unknown): Promise<MessagingResult> => {
    const why = reasonText.safeParse(reason)
    const parsed = parseSmsAccount(raw)
    if (!why.success) return { ok: false, reason: 'INVALID_INPUT' }
    if (!parsed.ok) return parsed
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const { account, secret, settings } = parsed
    const checked = await checkSms(account)
    if (checked === 'rejected') return { ok: false, reason: 'KEY_REJECTED' }
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    const keyEnc = await secrets.seal(secret)
    return withSystemScope(sql, async (tx): Promise<MessagingResult> => {
      await serialise(tx, `platform_messaging:sms:${account.provider}`)
      const before = await selectOurAccount(tx, 'sms', account.provider)
      await upsertOurAccount(tx, 'sms', account.provider, { keyEnc, keyPrefix: hintOf(secret), settings, testedAt: now(), createdBy: madeBy })
      await record(tx, platformMessagingAudit.smsSave, smsTarget(account.provider), why.data, [{ field: 'provider', before: before ? account.provider : null, after: account.provider }])
      return { ok: true, status: 'ok' }
    })
  }

  const testSms = async (provider: string): Promise<MessagingResult> => {
    if (!isProvider(provider)) return { ok: false, reason: 'NOT_FOUND' }
    const sealed = await withSystemScope(sql, (tx) => selectOurAccount(tx, 'sms', provider))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    const account = await openSmsAccount(secrets, { ...sealed, provider })
    if (!account) return { ok: false, reason: 'NOT_CONFIGURED' }
    const checked = await checkSms(account)
    if (checked === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    return withSystemScope(sql, async (tx): Promise<MessagingResult> => {
      const row = await selectOurAccount(tx, 'sms', provider)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateOurAccountTest(tx, row.id, checked, now())
      await record(tx, platformMessagingAudit.smsTest, smsTarget(provider), null, [{ field: 'status', before: row.status, after: checked }])
      return { ok: true, status: checked }
    })
  }

  const removeSms = (provider: string, reason: unknown): Promise<MessagingResult> => {
    const why = reasonText.safeParse(reason)
    if (!why.success || !isProvider(provider)) return Promise.resolve({ ok: false, reason: why.success ? 'NOT_FOUND' : 'INVALID_INPUT' })
    return withSystemScope(sql, async (tx): Promise<MessagingResult> => {
      await serialise(tx, `platform_messaging:sms:${provider}`)
      const row = await selectOurAccount(tx, 'sms', provider)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await deleteOurAccount(tx, row.id)
      await record(tx, platformMessagingAudit.smsRemove, smsTarget(provider), why.data)
      return { ok: true }
    })
  }

  /** Which saved account serves a route; null hands it to the first of the route's providers DripFunnel holds. */
  const setSmsRoute = (route: string, provider: string | null, reason: unknown): Promise<MessagingResult> => {
    const why = reasonText.safeParse(reason)
    const which = smsRoutes.find((r) => r === route)
    if (!why.success || !which || (provider !== null && !(routeProviders[which] as readonly string[]).includes(provider))) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    const chosen = provider !== null && isProvider(provider) ? provider : null
    return withSystemScope(sql, async (tx): Promise<MessagingResult> => {
      await serialise(tx, 'platform_messaging:sms')
      if (chosen) {
        const row = await selectOurAccount(tx, 'sms', chosen)
        if (!row || !savedServes({ ...row, provider: chosen }, which)) return { ok: false, reason: 'ACCOUNT_INCOMPLETE' }
      }
      const before = (await selectOurMessaging(tx)).routes[which]
      if (before === chosen) return { ok: true }
      await updateOurSmsRoute(tx, which, chosen, now())
      await record(tx, platformMessagingAudit.smsRoute, { type: 'platform_sms', id: which, label: 'SMS' }, why.data, [{ field: `route_${which}`, before, after: chosen }])
      return { ok: true }
    })
  }

  const whatsAppAccount = () =>
    withSystemScope(sql, async (tx) => {
      const row = (await selectOurAccounts(tx, 'whatsapp'))[0]
      return { enabled: (await selectOurMessaging(tx)).whatsappEnabled, account: row ? whatsappAccountDto(row) : null }
    })

  const saveWhatsApp = async (raw: unknown, reason: unknown): Promise<MessagingResult> => {
    const why = reasonText.safeParse(reason)
    const parsed = parseWhatsAppAccount(raw)
    if (!why.success || !parsed.ok) return { ok: false, reason: 'INVALID_INPUT' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const { accessToken, settings } = parsed
    const checked = await checkWhatsApp({ ...settings, accessToken })
    if (checked.status === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    if (checked.status === 'rejected') return { ok: false, reason: 'KEY_REJECTED', ...whatsappProblemOf(checked) }
    const keyEnc = await secrets.seal(accessToken)
    return withSystemScope(sql, async (tx): Promise<MessagingResult> => {
      await serialise(tx, 'platform_messaging:whatsapp')
      // While on, partners' codes may go through it, so it keeps its approved `code.portal`, as a partner's does.
      if (!settings.templates['code.portal'] && (await selectOurMessaging(tx)).whatsappEnabled) return { ok: false, reason: 'NO_CODE_TEMPLATE' }
      const before = await selectOurAccount(tx, 'whatsapp', 'meta')
      await upsertOurAccount(tx, 'whatsapp', 'meta', { keyEnc, keyPrefix: hintOf(accessToken), settings, testedAt: now(), createdBy: madeBy })
      await record(tx, platformMessagingAudit.whatsappSave, whatsappTarget, why.data, [{ field: 'phone_number_id', before: before ? whatsappAccountDto(before).phoneNumberId : null, after: settings.phoneNumberId }])
      return { ok: true, status: 'ok' }
    })
  }

  const testWhatsApp = async (): Promise<MessagingResult> => {
    const sealed = await withSystemScope(sql, (tx) => selectOurAccount(tx, 'whatsapp', 'meta'))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    const opened = await openWhatsAppAccount(secrets, sealed)
    if (!opened) return { ok: false, reason: 'NOT_CONFIGURED' }
    const checked = await checkWhatsApp(opened)
    if (checked.status === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    const status = checked.status === 'ok' ? 'ok' : 'rejected'
    return withSystemScope(sql, async (tx): Promise<MessagingResult> => {
      await serialise(tx, 'platform_messaging:whatsapp')
      const row = await selectOurAccount(tx, 'whatsapp', 'meta')
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateOurAccountTest(tx, row.id, status, now())
      await record(tx, platformMessagingAudit.whatsappTest, whatsappTarget, checked.status === 'rejected' ? checked.problem : null, [{ field: 'status', before: row.status, after: status }])
      // A rejected account can't send codes, so it goes off with it, as a partner's does.
      if (status === 'rejected' && (await selectOurMessaging(tx)).whatsappEnabled) {
        await updateOurWhatsAppEnabled(tx, false, now())
        await record(tx, platformMessagingAudit.whatsappDisabled, whatsappTarget, 'test_rejected', [{ field: 'whatsapp_enabled', before: true, after: false }])
      }
      return { ok: true, status, ...(checked.status === 'rejected' ? whatsappProblemOf(checked) : {}) }
    })
  }

  /** On needs a Working account with `code.portal`; off stops every partner's use of it, their choices kept. */
  const setWhatsAppEnabled = (enabled: boolean, reason: unknown): Promise<MessagingResult> => {
    const why = reasonText.safeParse(reason)
    if (!why.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    return withSystemScope(sql, async (tx): Promise<MessagingResult> => {
      await serialise(tx, 'platform_messaging:whatsapp')
      const before = (await selectOurMessaging(tx)).whatsappEnabled
      if (before === enabled) return { ok: true }
      if (enabled) {
        const row = await selectOurAccount(tx, 'whatsapp', 'meta')
        if (!row) return { ok: false, reason: 'NO_ACCOUNT' }
        if (!servesCodes(row)) return { ok: false, reason: 'NO_CODE_TEMPLATE' }
      }
      await updateOurWhatsAppEnabled(tx, enabled, now())
      await record(tx, enabled ? platformMessagingAudit.whatsappEnabled : platformMessagingAudit.whatsappDisabled, whatsappTarget, why.data, [{ field: 'whatsapp_enabled', before, after: enabled }])
      return { ok: true }
    })
  }

  const removeWhatsApp = (reason: unknown): Promise<MessagingResult> => {
    const why = reasonText.safeParse(reason)
    if (!why.success) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    return withSystemScope(sql, async (tx): Promise<MessagingResult> => {
      await serialise(tx, 'platform_messaging:whatsapp')
      const row = await selectOurAccount(tx, 'whatsapp', 'meta')
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      const wasOn = (await selectOurMessaging(tx)).whatsappEnabled
      await deleteOurAccount(tx, row.id)
      if (wasOn) await updateOurWhatsAppEnabled(tx, false, now())
      await record(tx, platformMessagingAudit.whatsappRemove, whatsappTarget, why.data, wasOn ? [{ field: 'whatsapp_enabled', before: true, after: false }] : [])
      return { ok: true }
    })
  }

  const asStaff = <T>(work: (tx: ScopedSql) => Promise<T>) => withScope(sql, { caller: { kind: 'staff', staffId: staff.id } }, work)
  const partnerName = async (tx: ScopedSql, partnerId: string) => (await tx<{ name: string }[]>`select name from partner where id = ${partnerId}`)[0]?.name ?? null

  /** Admin's two switches for a partner; null for one that doesn't exist. */
  const partnerSwitches = (partnerId: string): Promise<Record<MessagingKind, boolean> | null> =>
    !isUuid(partnerId) ? Promise.resolve(null) : asStaff(async (tx) => ((await partnerName(tx, partnerId)) === null ? null : selectDfMessaging(tx, partnerId)))

  type SwitchResult = { ok: true; value: Record<MessagingKind, boolean> } | { ok: false; reason: 'INVALID_INPUT' | 'NOT_FOUND' }

  /**
   * Lets a partner use DripFunnel's account for a channel, or stops it (#1543). Off moves each route or WhatsApp the partner
   * set to DripFunnel's back to its own account, or to none; its choice stays for when it is on again.
   */
  const setPartnerSwitch = (partnerId: string, channel: string, enabled: boolean, reason: unknown): Promise<SwitchResult> => {
    const why = reasonText.safeParse(reason)
    const kind = channels.find((c) => c === channel)
    if (!why.success || !kind) return Promise.resolve({ ok: false, reason: 'INVALID_INPUT' })
    if (!isUuid(partnerId)) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return asStaff(async (tx): Promise<SwitchResult> => {
      await serialise(tx, `partner_df_messaging:${partnerId}`)
      const name = await partnerName(tx, partnerId)
      if (name === null) return { ok: false, reason: 'NOT_FOUND' }
      const before = await selectDfMessaging(tx, partnerId)
      if (before[kind] === enabled) return { ok: true, value: before }
      await updateDfMessaging(tx, partnerId, kind, enabled)
      const action = kind === 'sms' ? (enabled ? platformMessagingAudit.partnerSmsEnabled : platformMessagingAudit.partnerSmsDisabled) : enabled ? platformMessagingAudit.partnerWhatsAppEnabled : platformMessagingAudit.partnerWhatsAppDisabled
      await activity.record(tx, entry({ action, reason: why.data, partnerId, target: { type: 'partner', id: partnerId, label: name }, visibility: 'partner', changes: [{ field: `df_${kind}_enabled`, before: before[kind], after: enabled }] }))
      return { ok: true, value: { ...before, [kind]: enabled } }
    })
  }

  return { smsAccounts, saveSms, testSms, removeSms, setSmsRoute, whatsAppAccount, saveWhatsApp, testWhatsApp, setWhatsAppEnabled, removeWhatsApp, partnerSwitches, setPartnerSwitch }
}

export type PlatformMessagingService = ReturnType<typeof createPlatformMessagingService>
