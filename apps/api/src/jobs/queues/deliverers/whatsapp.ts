import type postgres from 'postgres'
import { z } from 'zod'
import { logEvent } from '#core/log'
import { SmsRefused } from '#core/sms'
import type { WhatsAppSender } from '#core/whatsapp'
import { skipReminder } from '#db/scoped/cartReminders'
import { withSystemScope } from '#db/scoped/index'
import type { Msg91WhatsAppCredentials } from '#integrations/msg91/index'
import { prepareWhatsAppReminder, type PartnerWhatsAppAccounts } from '#saas/whatsapp/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// `whatsapp` (#321; THIRD-PARTY-ACCESS §2.8): a cart reminder by the partner's WhatsApp Business number through MSG91. MSG91
// takes no idempotency key, so a crash after it accepts and before the row is marked can send twice, as a text can.

const payload = z.object({ reminderId: z.uuid() }).strict()

export const whatsappDeliverer = (sql: postgres.Sql, accounts: PartnerWhatsAppAccounts, sender: (credentials: Msg91WhatsAppCredentials) => WhatsAppSender, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect, signal) => {
    const log = (event: string, code: string) => logEvent({ event, api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code })
    const parsed = payload.safeParse(effect.payload)
    const partnerId = effect.partnerId
    if (!parsed.success || !partnerId) {
      log('whatsapp_skipped', 'bad_payload')
      throw new GiveUp('bad_payload')
    }
    const reminderId = parsed.data.reminderId
    try {
      await withSystemScope(sql, async (tx) => {
        const account = await accounts.forPartner(tx, partnerId)
        // Decided for WhatsApp while the account was there (cart.remind); gone since, the reminder is left unsent.
        if (!account) return log('whatsapp_skipped', 'no_account')
        const prepared = await prepareWhatsAppReminder(tx, reminderId, { partnerId, storeId: effect.storeId }, account, now())
        if (!prepared.send) return log('whatsapp_skipped', prepared.reason)
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
