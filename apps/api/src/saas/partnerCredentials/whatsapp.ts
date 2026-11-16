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
  selectWhatsAppEnabled,
  updateWhatsAppAccount,
  updateWhatsAppAccountTest,
  updateWhatsAppEnabled,
} from '#db/scoped/partnerCredentials'
import { partnerEntry } from '#saas/activity/index'
import { openWhatsAppAccount, whatsappSettingsSchema, whatsappTemplates, type PartnerWhatsAppAccount, type WhatsAppSettings } from '#saas/whatsapp/index'

// Settings › Integrations, WhatsApp (#1504; THIRD-PARTY-ACCESS §4, §8.3): the partner's own WhatsApp Business account on
// Meta's Cloud API and its WhatsApp switch. The token is sealed on the way in and shown back as its last four only.

export const whatsappAudit = {
  save: 'partner.whatsapp_account_saved',
  test: 'partner.whatsapp_account_tested',
  remove: 'partner.whatsapp_account_removed',
  enabled: 'partner.whatsapp_enabled',
  disabled: 'partner.whatsapp_disabled',
} as const

const saveInput = z.strictObject({
  accessToken: z.string().trim().regex(/^[A-Za-z0-9._-]{20,2048}$/),
  businessAccountId: z.string().trim(),
  phoneNumberId: z.string().trim(),
  language: z.string().trim(),
  templates: z.array(z.strictObject({ message: z.enum(whatsappTemplates), name: z.string().trim() })).max(whatsappTemplates.length),
})

export type WhatsAppAccountRefusal = 'INVALID_INPUT' | 'KEY_REJECTED' | 'PROVIDER_UNAVAILABLE' | 'NOT_CONFIGURED' | 'NOT_FOUND' | 'NO_ACCOUNT'
type Rejected = Extract<WhatsAppAccountCheck, { status: 'rejected' }>
/** Which part Meta refused, for the panel to name: the token, the number, the business account, or one template. */
type Problem = { problem?: Rejected['problem']; template?: string }
type Result = ({ ok: true; status?: 'ok' | 'rejected' } & Problem) | ({ ok: false; reason: WhatsAppAccountRefusal } & Problem)

const hintOf = (secret: string) => `…${secret.slice(-4)}`
const problemOf = (check: Rejected): Problem => (check.problem === 'template' ? { problem: check.problem, template: check.template } : { problem: check.problem })

const parseSave = (raw: unknown): { ok: true; accessToken: string; settings: WhatsAppSettings } | { ok: false } => {
  const parsed = saveInput.safeParse(raw)
  if (!parsed.success) return { ok: false }
  const { accessToken, templates, ...ids } = parsed.data
  if (new Set(templates.map((t) => t.message)).size !== templates.length) return { ok: false }
  // A template left blank is one the partner doesn't use: its message goes by email or SMS instead.
  const settings = whatsappSettingsSchema.safeParse({ ...ids, templates: Object.fromEntries(templates.filter((t) => t.name !== '').map((t) => [t.message, t.name])) })
  return settings.success ? { ok: true, accessToken, settings: settings.data } : { ok: false }
}

const dto = (r: PartnerWhatsAppAccountRow) => {
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

export interface PartnerWhatsAppDeps {
  sql: postgres.Sql
  caller: PartnerCaller
  facts: RequestFacts
  activity: ActivityLog
  secrets: SecretBox | null
  /** Read-only calls to Meta: nothing is sent. */
  checkWhatsApp: (account: PartnerWhatsAppAccount) => Promise<WhatsAppAccountCheck>
  now: () => Date
}

export const createPartnerWhatsAppService = ({ sql, caller, facts, activity, secrets, checkWhatsApp, now }: PartnerWhatsAppDeps) => {
  const partnerId = caller.partner.id
  const context = partnerContextOf(caller)
  const entry = partnerEntry(caller, facts)
  const target = { type: 'whatsapp_account', id: partnerId, label: 'WhatsApp' }
  const lock = (tx: ScopedSql) => serialise(tx, `partner_whatsapp:${partnerId}`)

  const account = () =>
    withScope(sql, context, async (tx) => {
      const row = await selectWhatsAppAccount(tx, partnerId)
      return { enabled: await selectWhatsAppEnabled(tx, partnerId), account: row ? dto(row) : null }
    })

  const save = async (raw: unknown): Promise<Result> => {
    const parsed = parseSave(raw)
    if (!parsed.ok) return { ok: false, reason: 'INVALID_INPUT' }
    if (!secrets) return { ok: false, reason: 'NOT_CONFIGURED' }
    const { accessToken, settings } = parsed
    const checked = await checkWhatsApp({ ...settings, accessToken })
    if (checked.status === 'unavailable') return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }
    if (checked.status === 'rejected') return { ok: false, reason: 'KEY_REJECTED', ...problemOf(checked) }
    const at = now()
    const write = { keyEnc: await secrets.seal(accessToken), keyPrefix: hintOf(accessToken), settings, status: 'ok' as const, testedAt: at, at }
    return withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx)
      const before = await selectWhatsAppAccount(tx, partnerId)
      if (before) await updateWhatsAppAccount(tx, before.id, write)
      else await insertWhatsAppAccount(tx, { ...write, partnerId, createdBy: actingName(caller) })
      await activity.record(tx, entry({ action: whatsappAudit.save, target, reason: before ? 'replaced' : null, changes: [{ field: 'phone_number_id', before: before ? dto(before).phoneNumberId : null, after: settings.phoneNumberId }] }))
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
    return withScope(sql, context, async (tx): Promise<Result> => {
      const row = await selectWhatsAppAccount(tx, partnerId)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      await updateWhatsAppAccountTest(tx, row.id, status, now())
      await activity.record(tx, entry({ action: whatsappAudit.test, target, reason: checked.status === 'rejected' ? checked.problem : null, changes: [{ field: 'status', before: row.status, after: status }] }))
      return { ok: true, status, ...(checked.status === 'rejected' ? problemOf(checked) : {}) }
    })
  }

  /** Removing the account turns WhatsApp off with it, so On never stands without an account. */
  const remove = (): Promise<Result> =>
    withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx)
      const row = await selectWhatsAppAccount(tx, partnerId)
      if (!row) return { ok: false, reason: 'NOT_FOUND' }
      const wasOn = await selectWhatsAppEnabled(tx, partnerId)
      await deleteWhatsAppAccount(tx, row.id)
      if (wasOn) await updateWhatsAppEnabled(tx, partnerId, false)
      await activity.record(tx, entry({ action: whatsappAudit.remove, target, reason: null, changes: wasOn ? [{ field: 'whatsapp_enabled', before: true, after: false }] : [] }))
      return { ok: true }
    })

  const setEnabled = (enabled: boolean): Promise<Result> =>
    withScope(sql, context, async (tx): Promise<Result> => {
      await lock(tx)
      const before = await selectWhatsAppEnabled(tx, partnerId)
      if (before === enabled) return { ok: true }
      if (enabled && !(await selectWhatsAppAccount(tx, partnerId))) return { ok: false, reason: 'NO_ACCOUNT' }
      await updateWhatsAppEnabled(tx, partnerId, enabled)
      await activity.record(tx, entry({ action: enabled ? whatsappAudit.enabled : whatsappAudit.disabled, target, reason: null, changes: [{ field: 'whatsapp_enabled', before, after: enabled }] }))
      return { ok: true }
    })

  return { account, save, test, remove, setEnabled }
}

export type PartnerWhatsAppService = ReturnType<typeof createPartnerWhatsAppService>
