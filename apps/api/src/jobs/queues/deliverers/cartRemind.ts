import type postgres from 'postgres'
import { z } from 'zod'
import { logEvent } from '#core/log'
import { decideReminder } from '#engine/modules/cartReminders/index'
import type { ScopedSql } from '#db/scoped/index'
import { NotYet } from '#saas/outbox/index'
import type { PartnerWhatsAppAccounts, WhatsAppMessage } from '#saas/whatsapp/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

// `cart.remind` (#321): one queued cart reminder, decided as it is delivered (engine/modules/cartReminders): skipped with
// its reason, held through the store's quiet hours, or queued on as its email or WhatsApp message.

const payload = z.object({ reminderId: z.uuid() }).strict()

/** `whatsapp`: the partners' WhatsApp accounts, where any can be read (locally, or once #275 reads them); null sends every reminder by email. */
export const cartRemindDeliverer = (sql: postgres.Sql, suppressionKey: string, whatsapp: PartnerWhatsAppAccounts | null, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect) => {
    const parsed = payload.safeParse(effect.payload)
    if (!parsed.success) throw new GiveUp('bad_payload')
    const whatsappReady = whatsapp ? async (tx: ScopedSql, partnerId: string, message: WhatsAppMessage) => Boolean((await whatsapp.forPartner(tx, partnerId))?.templates[message]) : undefined
    const decision = await decideReminder({ sql, now, suppressionKey, ...(whatsappReady ? { whatsappReady } : {}) }, parsed.data.reminderId, { partnerId: effect.partnerId, storeId: effect.storeId })
    if (decision.kind === 'wait') throw new NotYet('quiet_hours', decision.ms)
    logEvent({ event: 'cart_reminder', api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code: decision.kind === 'skipped' ? decision.reason : decision.kind })
  },
})
