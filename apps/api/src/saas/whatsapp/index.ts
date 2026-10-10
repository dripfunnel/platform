import { z } from 'zod'
import { hashSessionId, newSessionId } from '#auth/session'
import { isE164 } from '#core/sms'
import type { OutgoingWhatsApp } from '#core/whatsapp'
import { markReminderSent, selectReminderToSend, selectShopHost, skipReminder } from '#db/scoped/cartReminders'
import type { ScopedSql } from '#db/scoped/index'

// What the platform sends by WhatsApp (THIRD-PARTY-ACCESS §2.8, decided on #337): abandoned-cart reminders, for stores in
// India. Each message is a template the partner has Meta approve, worded here exactly as it is registered, variables in
// this order; the store's own subject and message never go by WhatsApp, as an approved template can't carry them.

export const whatsappKind = 'whatsapp'

export const whatsappMessages = ['cart.reminder', 'cart.reminder_code'] as const
export type WhatsAppMessage = (typeof whatsappMessages)[number]

// English for the first release, as the texts are (saas/sms).
export const whatsappWording: Record<WhatsAppMessage, string> = {
  'cart.reminder': '{{1}}: you left {{2}} in your cart. It’s saved for you: {{3}}',
  'cart.reminder_code': '{{1}}: you left {{2}} in your cart. Use {{3}} for {{4}}% off, once, for 48 hours: {{5}}',
}

/** A partner's WhatsApp Business number on its own MSG91 account (THIRD-PARTY-ACCESS §8.3), as #275 will read it. */
export interface PartnerWhatsAppAccount {
  authKey: string
  integratedNumber: string
  language: string
  templates: Partial<Record<WhatsAppMessage, string>>
}

export interface PartnerWhatsAppAccounts {
  forPartner: (tx: ScopedSql, partnerId: string) => Promise<PartnerWhatsAppAccount | null>
}

export type PreparedWhatsApp = { send: true; message: OutgoingWhatsApp } | { send: false; reason: 'link_closed' | 'tenant_mismatch' | 'no_recipient' | 'no_template' | 'no_shop_host' }

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
export const prepareWhatsAppReminder = async (tx: ScopedSql, reminderId: string, row: { partnerId: string | null; storeId: string | null }, account: PartnerWhatsAppAccount, now: Date): Promise<PreparedWhatsApp> => {
  const r = await selectReminderToSend(tx, reminderId)
  if (!r || r.state !== 'queued' || r.channel !== 'whatsapp') return { send: false, reason: 'link_closed' }
  if (r.partner_id !== row.partnerId || r.store_id !== row.storeId) return { send: false, reason: 'tenant_mismatch' }
  if (!r.phone || !isE164(r.phone)) return { send: false, reason: 'no_recipient' }
  const message: WhatsAppMessage = r.code && r.code_percent ? 'cart.reminder_code' : 'cart.reminder'
  const template = account.templates[message]
  if (!template) return { send: false, reason: 'no_template' }
  const host = await selectShopHost(tx, r.store_id)
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
