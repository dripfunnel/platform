import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { SmsRefused } from '#core/sms'
import type { WhatsAppSender } from '#core/whatsapp'
import { skipReminder } from '#db/scoped/cartReminders'
import { withSystemScope } from '#db/scoped/index'
import type { Msg91WhatsAppCredentials } from '#integrations/msg91/index'
import { fallBackToEmail } from '#engine/modules/cartReminders/index'
import { prepareWhatsAppReminder, whatsappPayloadSchema, type PartnerWhatsAppAccounts } from '#saas/whatsapp/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// `whatsapp` (#321; THIRD-PARTY-ACCESS §2.8): a cart reminder by the partner's WhatsApp Business number through MSG91. MSG91
// takes no idempotency key, so a crash after it accepts and before the row is marked can send twice, as a text can.

/** `suppressionKey`: EMAIL_SUPPRESSION_KEY, for a reminder that falls back to email. */
export const whatsappDeliverer = (sql: postgres.Sql, accounts: PartnerWhatsAppAccounts, sender: (credentials: Msg91WhatsAppCredentials) => WhatsAppSender, suppressionKey: string, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect, signal) => {
    const log = (event: string, code: string) => logEvent({ event, api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code })
    const parsed = whatsappPayloadSchema.safeParse(effect.payload)
    const partnerId = effect.partnerId
    if (!parsed.success || !partnerId) {
      log('whatsapp_skipped', 'bad_payload')
      throw new GiveUp('bad_payload')
    }
    const reminderId = parsed.data.reminderId
    try {
      await withSystemScope(sql, async (tx) => {
        const account = await accounts.forPartner(tx, partnerId)
        // Decided for WhatsApp while it could go (cart.remind); its account, template or number gone since, it may go by email.
        const prepared = account ? await prepareWhatsAppReminder(tx, reminderId, { partnerId, storeId: effect.storeId }, account, now()) : null
        if (!account || !prepared?.send) {
          const reason = prepared && !prepared.send ? prepared.reason : 'no_account'
          const fallsBack = reason === 'no_account' || reason === 'no_template' || reason === 'no_recipient'
          return log('whatsapp_skipped', fallsBack ? `${reason}:${(await fallBackToEmail(tx, parsed.data, suppressionKey, now())) ?? 'decided'}` : reason)
        }
        await sender({ authKey: account.authKey, integratedNumber: account.integratedNumber }).send(prepared.message, signal)
        log('whatsapp_sent', 'msg91')
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
