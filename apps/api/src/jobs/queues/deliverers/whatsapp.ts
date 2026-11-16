import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { SmsRefused } from '#core/sms'
import type { WhatsAppSender } from '#core/whatsapp'
import { skipReminder } from '#db/scoped/cartReminders'
import { withSystemScope } from '#db/scoped/index'
import { fallBackToEmail } from '#engine/modules/cartReminders/index'
import {
  prepareWhatsAppReminder,
  whatsappCodeMessage,
  whatsappCodePayloadSchema,
  whatsappPayloadSchema,
  type PartnerWhatsAppAccount,
  type PartnerWhatsAppAccounts,
  type WhatsAppCodePayload,
} from '#saas/whatsapp/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// `whatsapp` (#321, #1504, #1506; THIRD-PARTY-ACCESS §2.8): a cart reminder or a portal code by the partner's WhatsApp Business
// number on Meta's Cloud API. Meta takes no idempotency key, so a crash after it accepts and before the row is marked can
// send twice, as a text can.

type Log = (event: string, code: string) => void

/** A portal code (ACCESS.md §4): never late, never by email, and nothing but the message kind left once it is done. */
const deliverCode = async (sql: postgres.Sql, accounts: PartnerWhatsAppAccounts, sender: (account: PartnerWhatsAppAccount) => WhatsAppSender, partnerId: string, payload: WhatsAppCodePayload, log: Log, now: Date, signal: AbortSignal): Promise<void> => {
  const drop = (event: string, code: string): never => {
    log(event, code)
    throw new GiveUp(code)
  }
  if (new Date(payload.expiresAt) <= now) return drop('whatsapp_skipped', 'expired')
  const account = await withSystemScope(sql, (tx) => accounts.forPartner(tx, partnerId))
  if (!account) return drop('whatsapp_skipped', 'no_account')
  const message = whatsappCodeMessage(account, payload)
  if (!message) return drop('whatsapp_skipped', 'no_template')
  try {
    await sender(account).send(message, signal)
  } catch (error) {
    if (error instanceof SmsRefused) return drop('whatsapp_refused', error.code)
    throw error
  }
  log('whatsapp_sent', 'meta')
}

/** `suppressionKey`: EMAIL_SUPPRESSION_KEY, for a reminder that falls back to email. */
export const whatsappDeliverer = (sql: postgres.Sql, accounts: PartnerWhatsAppAccounts, sender: (account: PartnerWhatsAppAccount) => WhatsAppSender, suppressionKey: string, shopDomain: string | null, now: () => Date = () => new Date()): Deliverer => ({
  // A code's number and digits leave the row once it is sent, dropped or dead; a reminder's row is kept as it was.
  redact: (payload) => {
    const reminder = whatsappPayloadSchema.safeParse(payload)
    return reminder.success ? reminder.data : { message: whatsappCodePayloadSchema.safeParse(payload).success ? 'code.portal' : null, redacted: true }
  },
  deliver: async (effect, signal) => {
    const log = (event: string, code: string) => logEvent({ event, api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code })
    const partnerId = effect.partnerId
    const code = whatsappCodePayloadSchema.safeParse(effect.payload)
    if (code.success && partnerId) return deliverCode(sql, accounts, sender, partnerId, code.data, log, now(), signal)
    const parsed = whatsappPayloadSchema.safeParse(effect.payload)
    if (!parsed.success || !partnerId) {
      log('whatsapp_skipped', 'bad_payload')
      throw new GiveUp('bad_payload')
    }
    const reminderId = parsed.data.reminderId
    try {
      await withSystemScope(sql, async (tx) => {
        const account = await accounts.forPartner(tx, partnerId)
        // Decided for WhatsApp while it could go (cart.remind); its account, switch, template or number gone since, it may go by email.
        const prepared = account ? await prepareWhatsAppReminder(tx, reminderId, { partnerId, storeId: effect.storeId }, account, shopDomain, now()) : null
        if (!account || !prepared?.send) {
          const reason = prepared && !prepared.send ? prepared.reason : 'no_account'
          const fallsBack = reason === 'no_account' || reason === 'no_template' || reason === 'no_recipient'
          return log('whatsapp_skipped', fallsBack ? `${reason}:${(await fallBackToEmail(tx, parsed.data, suppressionKey, now())) ?? 'decided'}` : reason)
        }
        await sender(account).send(prepared.message, signal)
        log('whatsapp_sent', 'meta')
      })
    } catch (error) {
      if (!(error instanceof SmsRefused)) throw error
      // Refused for good (not on WhatsApp, a template withdrawn): the send rolled back, so the reminder says so.
      log('whatsapp_refused', error.code)
      await withSystemScope(sql, (tx) => skipReminder(tx, reminderId, 'undeliverable'))
      throw new GiveUp(error.code)
    }
  },
})
