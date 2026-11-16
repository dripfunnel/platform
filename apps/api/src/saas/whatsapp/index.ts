import { z } from 'zod'
import { hashSessionId, newSessionId } from '#auth/session'
import type { SecretBox } from '#auth/secretBox'
import { isE164 } from '#core/sms'
import type { OutgoingWhatsApp } from '#core/whatsapp'
import { markReminderSent, selectReminderToSend, selectShopHost, skipReminder } from '#db/scoped/cartReminders'
import type { ScopedSql } from '#db/scoped/index'
import { expireUnsent } from '#db/scoped/outbox'
import { selectSealedWhatsAppAccount } from '#db/scoped/partnerCredentials'
import { mayWhatsApp } from '#engine/modules/cartReminders/index'
import { queueSideEffect } from '#saas/outbox/index'

// What the platform sends by WhatsApp (THIRD-PARTY-ACCESS §2.8, §4): abandoned-cart reminders for stores in India, and portal
// codes (#1506, ACCESS.md §4), through the partner's own account on Meta's Cloud API (#1504). Each message is a template the partner has Meta approve, worded
// here exactly as it is registered, variables in this order; the store's own subject and message never go by WhatsApp.

export const whatsappKind = 'whatsapp'

export const whatsappMessages = ['cart.reminder', 'cart.reminder_code'] as const
export type WhatsAppMessage = (typeof whatsappMessages)[number]

/** Every template an account names: the cart reminders, and the portal code's authentication template. */
export const whatsappTemplates = ['code.portal', ...whatsappMessages] as const
export type WhatsAppTemplate = (typeof whatsappTemplates)[number]

// English for the first release, as the texts are (saas/sms).
export const whatsappWording: Record<WhatsAppMessage, string> = {
  'cart.reminder': '{{1}}: you left {{2}} in your cart. It’s saved for you: {{3}}',
  'cart.reminder_code': '{{1}}: you left {{2}} in your cart. Use {{3}} for {{4}}% off, once, for 48 hours: {{5}}',
}

const metaIdSchema = z.string().regex(/^\d{5,25}$/)

/** What `partner_credential.settings` holds for a `whatsapp` row: everything but the token (THIRD-PARTY-ACCESS §8.3). */
export const whatsappSettingsSchema = z.strictObject({
  businessAccountId: metaIdSchema,
  phoneNumberId: metaIdSchema,
  // Meta's template language codes: `en`, `en_US`, `pt_BR`.
  language: z.string().regex(/^[a-z]{2,3}(_[A-Za-z]{2,4})?$/),
  templates: z.partialRecord(z.enum(whatsappTemplates), z.string().regex(/^[a-z0-9_]{1,512}$/)),
})
export type WhatsAppSettings = z.infer<typeof whatsappSettingsSchema>

/** A partner's WhatsApp Business account on Meta's Cloud API, its token opened (THIRD-PARTY-ACCESS §8.3). */
export interface PartnerWhatsAppAccount extends WhatsAppSettings {
  accessToken: string
}

/** The partner's account while its WhatsApp is on; null when it is off, missing, or can't be opened. Called in system scope. */
export interface PartnerWhatsAppAccounts {
  forPartner: (tx: ScopedSql, partnerId: string) => Promise<PartnerWhatsAppAccount | null>
}

/** A saved account, opened; null where its token or settings can't be read, so it never half sends. */
export const openWhatsAppAccount = async (secrets: SecretBox | null, row: { key_enc: string; settings: unknown }): Promise<PartnerWhatsAppAccount | null> => {
  const settings = whatsappSettingsSchema.safeParse(row.settings)
  const accessToken = settings.success && secrets ? await secrets.open(row.key_enc) : null
  return settings.success && accessToken ? { ...settings.data, accessToken } : null
}

export const whatsappAccountsFor = (secrets: SecretBox | null): PartnerWhatsAppAccounts => ({
  forPartner: async (tx, partnerId) => {
    const sealed = await selectSealedWhatsAppAccount(tx, partnerId)
    return sealed?.enabled ? openWhatsAppAccount(secrets, sealed) : null
  },
})

export type PreparedWhatsApp = { send: true; message: OutgoingWhatsApp } | { send: false; reason: 'link_closed' | 'tenant_mismatch' | 'no_recipient' | 'no_template' | 'no_shop_host' | 'opted_out' }

/** The `whatsapp` outbox row: the reminder, and the email it becomes if WhatsApp can't take it (cartReminders jobs.ts). */
export const whatsappPayloadSchema = z
  .object({
    reminderId: z.uuid(),
    currency: z.string().regex(/^[A-Z]{3}$/),
    lines: z.array(z.object({ name: z.string().max(400), quantity: z.number().int().min(1).max(999), amount: z.string().regex(/^\d{1,18}$/).nullable() }).strict()).max(100),
  })
  .strict()
export type WhatsAppPayload = z.infer<typeof whatsappPayloadSchema>

const itemsIn = (n: number) => (n === 1 ? '1 item' : `${n} items`)

/**
 * A cart reminder by WhatsApp, its link minted now and the reminder marked sent, in the transaction that sends it: a
 * failed send leaves neither behind, and a second delivery finds it sent.
 */
export const prepareWhatsAppReminder = async (tx: ScopedSql, reminderId: string, row: { partnerId: string | null; storeId: string | null }, account: PartnerWhatsAppAccount, shopDomain: string | null, now: Date): Promise<PreparedWhatsApp> => {
  const r = await selectReminderToSend(tx, reminderId)
  if (!r || r.state !== 'queued' || r.channel !== 'whatsapp') return { send: false, reason: 'link_closed' }
  if (r.partner_id !== row.partnerId || r.store_id !== row.storeId) return { send: false, reason: 'tenant_mismatch' }
  if (!r.phone || !isE164(r.phone)) return { send: false, reason: 'no_recipient' }
  // Asked again as it goes: an outbox retry can come after the shopper stopped or dropped WhatsApp.
  if (!mayWhatsApp(r.consent)) {
    await skipReminder(tx, reminderId, 'opted_out')
    return { send: false, reason: 'opted_out' }
  }
  const message: WhatsAppMessage = r.code && r.code_percent ? 'cart.reminder_code' : 'cart.reminder'
  const template = account.templates[message]
  if (!template) return { send: false, reason: 'no_template' }
  const host = await selectShopHost(tx, r.store_id, shopDomain)
  if (!host) {
    await skipReminder(tx, reminderId, 'no_shop_host')
    return { send: false, reason: 'no_shop_host' }
  }
  const token = newSessionId()
  if (!(await markReminderSent(tx, reminderId, await hashSessionId(token), now))) return { send: false, reason: 'link_closed' }
  const store = r.store_name.trim().slice(0, 30)
  const link = `https://${host}/cart/r/${token}`
  const vars = message === 'cart.reminder_code' ? [store, itemsIn(r.items), r.code ?? '', String(r.code_percent ?? ''), link] : [store, itemsIn(r.items), link]
  return { send: true, message: { to: r.phone, template, language: account.language, vars } }
}

/** A portal code's `whatsapp` outbox row (ACCESS.md §4): `code.portal`, Meta's authentication template, to the person's number. */
export const whatsappCodePayloadSchema = z
  .object({
    message: z.literal('code.portal'),
    to: z.string().refine(isE164, 'an E.164 number'),
    code: z.string().regex(/^\d{6}$/),
    /** A code older than this is useless; the deliverer and the cron's sweep drop it rather than send it late. */
    expiresAt: z.iso.datetime(),
  })
  .strict()
export type WhatsAppCodePayload = z.infer<typeof whatsappCodePayloadSchema>

/** Queues a portal code in the transaction that made it; the caller's key (the code's own id) keeps a retry from sending twice. */
export const queueWhatsAppCode = (tx: ScopedSql, effect: { partnerId: string; idempotencyKey: string; payload: WhatsAppCodePayload }): Promise<string | null> =>
  queueSideEffect(tx, { kind: whatsappKind, idempotencyKey: effect.idempotencyKey, payload: whatsappCodePayloadSchema.parse(effect.payload), partnerId: effect.partnerId, storeId: null })

/** The code as `code.portal` carries it: the body's one variable and the Copy code button; null when the account names no such template. */
export const whatsappCodeMessage = (account: PartnerWhatsAppAccount, payload: WhatsAppCodePayload): OutgoingWhatsApp | null => {
  const template = account.templates['code.portal']
  return template ? { to: payload.to, template, language: account.language, vars: [payload.code], copyCode: payload.code } : null
}

/** The cron's sweep for portal codes nobody sent in time, as for texts (saas/sms); a cart reminder has no expiry and is left. */
export const expireUnsentWhatsAppCodes = (tx: ScopedSql, now: Date, leaseMs: number): Promise<number> =>
  expireUnsent(tx, { kind: whatsappKind, expiresAtKey: 'expiresAt', fallbackMs: null, keep: ['message'], leaseMs, limit: 500 }, now)
