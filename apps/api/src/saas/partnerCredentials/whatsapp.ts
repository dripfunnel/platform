import type postgres from 'postgres'
import { z } from 'zod'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { actingName, type PartnerCaller, partnerContextOf } from '#auth/partnerCaller'
import type { SecretBox } from '#auth/secretBox'
import type { WhatsAppAccountCheck } from '#core/whatsapp'
import type { PartnerWhatsAppAccountRow } from '#db/schema/saas'
import { serialise, withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  deleteWhatsAppAccount,
  insertWhatsAppAccount,
  selectSealedWhatsAppAccount,
  selectWhatsAppAccount,
  selectWhatsAppChoice,
  selectWhatsAppEnabled,
  updateWhatsAppAccount,
  updateWhatsAppAccountTest,
  updateWhatsAppChoice,
  updateWhatsAppEnabled,
} from '#db/scoped/partnerCredentials'
import { partnerEntry } from '#saas/activity/index'
import { senderOf } from '#saas/sms/index'
import { openWhatsAppAccount, whatsappSettingsSchema, whatsappTemplates, type OurWhatsApp, type PartnerWhatsAppAccount, type WhatsAppSettings } from '#saas/whatsapp/index'

// Settings › Integrations, WhatsApp (#1504; THIRD-PARTY-ACCESS §4, §8.3): the partner's own WhatsApp Business account on
// Meta's Cloud API and its WhatsApp switch. The token is sealed on the way in and shown back as its last four only.

export const whatsappAudit = {
  save: 'partner.whatsapp_account_saved',
  test: 'partner.whatsapp_account_tested',
  remove: 'partner.whatsapp_account_removed',
  enabled: 'partner.whatsapp_enabled',
  disabled: 'partner.whatsapp_disabled',
  chosen: 'partner.whatsapp_account_chosen',
} as const

const saveInput = z.strictObject({
  accessToken: z.string().trim().regex(/^[A-Za-z0-9._-]{20,2048}$/),
  businessAccountId: z.string().trim(),
  phoneNumberId: z.string().trim(),
  language: z.string().trim(),
  templates: z.array(z.strictObject({ message: z.enum(whatsappTemplates), name: z.string().trim() })).max(whatsappTemplates.length),
})

export type WhatsAppAccountRefusal = 'INVALID_INPUT' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'NO_ACCOUNT' | 'NO_CODE_TEMPLATE' | 'DRIPFUNNEL_UNAVAILABLE'
type Rejected = Extract<WhatsAppAccountCheck, { status: 'rejected' }>
/** Which part Meta refused, for the panel to name: the token, the number, the business account, or one template. */
type Problem = { problem?: Rejected['problem']; template?: string }
type Result = ({ ok: true; status?: 'ok' | 'rejected' } & Problem) | ({ ok: false; reason: WhatsAppAccountRefusal } & Problem)

const hintOf = (secret: string) => `…${secret.slice(-4)}`
export const whatsappProblemOf = (check: Rejected): Problem => (check.problem === 'template' ? { problem: check.problem, template: check.template } : { problem: check.problem })

/** An account as typed, checked against Meta's shapes; DripFunnel's own is typed the same way (#1543). */
export const parseWhatsAppAccount = (raw: unknown): { ok: true; accessToken: string; settings: WhatsAppSettings } | { ok: false } => {
  const parsed = saveInput.safeParse(raw)
  if (!parsed.success) return { ok: false }
  const { accessToken, templates, ...ids } = parsed.data
  if (new Set(templates.map((t) => t.message)).size !== templates.length) return { ok: false }
  // A template left blank is one the partner doesn't use: its message goes by email or SMS instead.
  const settings = whatsappSettingsSchema.safeParse({ ...ids, templates: Object.fromEntries(templates.filter((t) => t.name !== '').map((t) => [t.message, t.name])) })
  return settings.success ? { ok: true, accessToken, settings: settings.data } : { ok: false }
}

/** What an account shows back, a partner's or DripFunnel's: never its token. */
export const whatsappAccountDto = (r: Pick<PartnerWhatsAppAccountRow, 'key_prefix' | 'status' | 'last_tested_at' | 'settings'>) => {
  const settings = whatsappSettingsSchema.safeParse(r.settings)
  const s = settings.success ? settings.data : null
  return {
    hint: r.key_prefix,
    businessAccountId: s?.businessAccountId ?? null,
    phoneNumberId: s?.phoneNumberId ?? null,
    language: s?.language ?? null,
    templates: whatsappTemplates.map((message) => ({ message, name: s?.templates[message] ?? null })),
    status: r.status,
    lastTestedAt: r.last_tested_at,
  }
}

/** On sends portal codes by WhatsApp, so it needs an approved `code.portal` (decided 2026-11-16, Gaurav; ACCESS §4). */
export const servesCodes = (row: Pick<PartnerWhatsAppAccountRow, 'key_prefix' | 'status' | 'last_tested_at' | 'settings'>) => row.status === 'ok' && Boolean(whatsappAccountDto(row).templates.find((t) => t.message === 'code.portal')?.name)

export interface PartnerWhatsAppDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  /** Read-only calls to Meta: nothing is sent. */
  checkWhatsApp: (account: PartnerWhatsAppAccount) => Promise<WhatsAppAccountCheck>
  /** DripFunnel's account as this partner may use it (#1543), as the deliverer reads it. */
  ourWhatsApp: OurWhatsApp
  now: () => Date
}

export const createPartnerWhatsAppService = ({ sql, caller, facts, activity, secrets, checkWhatsApp, ourWhatsApp, now }: PartnerWhatsAppDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const target = { type: 'whatsapp_account', id: partnerId, label: 'WhatsApp' }
  const lock = (tx: ScopedSql) => serialise(tx, `partner_whatsapp:${partnerId}`)

  // DripFunnel's account is read in system scope, as the deliverer reads it; only whether it is there leaves it.
  const oursUsable = () => withSystemScope(sql, async (tx) => (await ourWhatsApp(tx, partnerId)) !== null)
  /** Whose account would send once On (#1543): the partner's choice where both are there, else the one that is. */
  const senderNow = async (tx: ScopedSql, hasOwn: boolean, ours: boolean) => senderOf(await selectWhatsAppChoice(tx, partnerId), hasOwn, ours)

  const account = async () => {
    const ours = await oursUsable()
    return withScope(sql, context, async (tx) => {
      const row = await selectWhatsAppAccount(tx, partnerId)
      return { enabled: await selectWhatsAppEnabled(tx, partnerId), account: row ? whatsappAccountDto(row) : null, dripfunnel: ours, choice: await selectWhatsAppChoice(tx, partnerId), sender: await senderNow(tx, row !== null, ours) }
    })
  }

  const save = async (raw: unknown): Promise<Result> => {
    const parsed = parseWhatsAppAccount(raw)
    if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const { accessToken, settings } = parsed
    const checked = await checkWhatsApp({ ...settings, accessToken })
    if (checked.status === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    if (checked.status === 'rejected') return { ok: false, reason: 'KEY_REJECTED', ...whatsappProblemOf(checked) }
    const at = now()
    const write = { keyEnc: await secrets.seal(accessToken), keyPrefix: hintOf(accessToken), settings, status: 'ok' as const, testedAt: at, at }
    const ours = await oursUsable()
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx)
      const before = await selectWhatsAppAccount(tx, partnerId)
      // While On, the account that will send must carry codes; DripFunnel's, where chosen, already does.
      const ownSends = (await senderNow(tx, true, ours)) === 'own'
      if (!settings.templates['code.portal'] && ownSends && (await selectWhatsAppEnabled(tx, partnerId))) return { ok: false, reason: 'NO_CODE_TEMPLATE' }
      if (before) await updateWhatsAppAccount(tx, before.id, write)
      else await insertWhatsAppAccount(tx, { ...write, partnerId, createdBy: actingName(caller) })
      await activity.record(tx, entry({ action: whatsappAudit.save, target, reason: before ? 'replaced' : null, changes: [{ field: 'phone_number_id', before: before ? whatsappAccountDto(before).phoneNumberId : null, after: settings.phoneNumberId }] }))
      return { ok: true, status: 'ok' }
    })
  }

  const test = async (): Promise<Result> => {
    // The sealed token is system-scope only, so the console path never holds it: the check reads it in its own scope.
    const sealed = await withSystemScope(sql, (tx) => selectSealedWhatsAppAccount(tx, partnerId))
    if (!sealed) return { ok: false, reason: 'NOT_FOUND' }
    const opened = await openWhatsAppAccount(secrets, sealed)
    if (!opened) return { ok: false, reason: 'NOT_CONFIGURED' }
    const checked = await checkWhatsApp(opened)
    if (checked.status === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    const status = checked.status === 'ok' ? 'ok' : 'rejected'
    const ours = await oursUsable()
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx)
      const row = await selectWhatsAppAccount(tx, partnerId)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateWhatsAppAccountTest(tx, row.id, status, now())
      await activity.record(tx, entry({ action: whatsappAudit.test, target, reason: checked.status === 'rejected' ? checked.problem : null, changes: [{ field: 'status', before: row.status, after: status }] }))
      // A rejected account can't send codes, so On goes off with it while it is the one that sends, as On needs Working.
      if (status === 'rejected' && (await senderNow(tx, row !== null, ours)) === 'own' && (await selectWhatsAppEnabled(tx, partnerId))) {
        await updateWhatsAppEnabled(tx, partnerId, false)
        await activity.record(tx, entry({ action: whatsappAudit.disabled, target, reason: 'test_rejected', changes: [{ field: 'whatsapp_enabled', before: true, after: false }] }))
      }
      return { ok: true, status, ...(checked.status === 'rejected' ? whatsappProblemOf(checked) : {}) }
    })
  }

  /** Removing the account turns WhatsApp off with it unless DripFunnel's is there to send, so On never stands without one. */
  const remove = async (): Promise<Result> => {
    const ours = await oursUsable()
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx)
      const row = await selectWhatsAppAccount(tx, partnerId)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      const wasOn = !ours && (await selectWhatsAppEnabled(tx, partnerId))
      await deleteWhatsAppAccount(tx, row.id)
      if (wasOn) await updateWhatsAppEnabled(tx, partnerId, false)
      await activity.record(tx, entry({ action: whatsappAudit.remove, target, reason: null, changes: wasOn ? [{ field: 'whatsapp_enabled', before: true, after: false }] : [] }))
      return { ok: true }
    })
  }

  /** On needs an account that carries codes: the partner's own with `code.portal`, or DripFunnel's where it sends (#1543). */
  const setEnabled = async (enabled: boolean): Promise<Result> => {
    const ours = await oursUsable()
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx)
      const before = await selectWhatsAppEnabled(tx, partnerId)
      if (before === enabled) return { ok: true }
      if (enabled) {
        const row = await selectWhatsAppAccount(tx, partnerId)
        const sender = await senderNow(tx, row !== null, ours)
        if (!sender) return { ok: false, reason: 'NO_ACCOUNT' }
        if (sender === 'own' && row && !servesCodes(row)) return { ok: false, reason: 'NO_CODE_TEMPLATE' }
      }
      await updateWhatsAppEnabled(tx, partnerId, enabled)
      await activity.record(tx, entry({ action: enabled ? whatsappAudit.enabled : whatsappAudit.disabled, target, reason: null, changes: [{ field: 'whatsapp_enabled', before, after: enabled }] }))
      return { ok: true }
    })
  }

  /**
   * Whose account sends while both are there (#1543): `dripfunnel` only where Admin enabled it and it is usable. While On,
   * the partner's own must carry codes to be chosen. The choice is kept when Admin turns DripFunnel's off.
   */
  const setChoice = async (choice: string): Promise<Result> => {
    if (choice !== 'own' && choice !== 'dripfunnel') return { ok: false, reason: 'INVALID_INPUT' }
    const ours = await oursUsable()
    if (choice === 'dripfunnel' && !ours) return { ok: false, reason: 'DRIPFUNNEL_UNAVAILABLE' }
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx)
      const before = await selectWhatsAppChoice(tx, partnerId)
      if (before === choice) return { ok: true }
      const row = await selectWhatsAppAccount(tx, partnerId)
      if (choice === 'own' && row && !servesCodes(row) && (await selectWhatsAppEnabled(tx, partnerId))) return { ok: false, reason: 'NO_CODE_TEMPLATE' }
      await updateWhatsAppChoice(tx, partnerId, choice)
      await activity.record(tx, entry({ action: whatsappAudit.chosen, target, reason: null, changes: [{ field: 'whatsapp_account', before, after: choice }] }))
      return { ok: true }
    })
  }

  return { account, save, test, remove, setEnabled, setChoice }
}

export type PartnerWhatsAppService = ReturnType<typeof createPartnerWhatsAppService>
