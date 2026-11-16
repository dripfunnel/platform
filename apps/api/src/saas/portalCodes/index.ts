import type { CodeChannel, OpenCodeChannels } from '#auth/storeCodes'
import { smsRouteFor, smsRoutes } from '#core/sms'
import type { ScopedSql } from '#db/scoped/index'
import { selectWhatsAppEnabled } from '#db/scoped/partnerCredentials'
import { queueSms, type PartnerSmsAccounts } from '#saas/sms/index'
import { queueWhatsAppCode } from '#saas/whatsapp/index'

// How a merchant-portal code reaches a phone (ACCESS.md §4, #1506): by the partner's WhatsApp first, by SMS on request.

/** Which channels reach a number, or with none yet (the brand, sign-up's number step) the partner's at all. Called in system scope. */
export interface CodeChannelCheck {
  forPartner: (tx: ScopedSql, partnerId: string, phone: string | null) => Promise<OpenCodeChannels>
}

/**
 * WhatsApp is open while the partner's switch is on (On already needs an approved `code.portal`, #1504). SMS is open while
 * the partner's SMS is on and an account, its own or DripFunnel's, serves the number's route; `sms` is null where the
 * Worker has no SMS deliverer, so nothing could send one.
 */
export const codeChannelsFor = (sms: PartnerSmsAccounts | null): CodeChannelCheck => ({
  forPartner: async (tx, partnerId, phone) => {
    const whatsapp = await selectWhatsAppEnabled(tx, partnerId)
    let open = false
    for (const route of phone ? [smsRouteFor(phone)] : smsRoutes) {
      const account = sms ? await sms.forPartner(tx, partnerId, route) : null
      open = account !== null && account !== 'off'
      if (open || account === 'off') break
    }
    return { whatsapp, sms: open }
  },
})

/** Where nothing can send a code: the Worker's context without a check. */
export const noCodeChannels: CodeChannelCheck = { forPartner: async () => ({ whatsapp: false, sms: false }) }

export interface PortalCode {
  partnerId: string
  channel: CodeChannel
  to: string
  /** What a text says the code is for; WhatsApp's authentication template words every code alike. */
  purpose: 'sign_in' | 'verify_phone'
  code: string
  expiresAt: Date
  /** The sender's name in a text: the partner's brand (white label). */
  brand: () => Promise<string>
  idempotencyKey: string
}

/** Queues one code by its channel, in the transaction that made it. */
export const queuePortalCode = async (tx: ScopedSql, c: PortalCode): Promise<void> => {
  const expiresAt = c.expiresAt.toISOString()
  if (c.channel === 'whatsapp') {
    await queueWhatsAppCode(tx, { partnerId: c.partnerId, idempotencyKey: c.idempotencyKey, payload: { message: 'code.portal', to: c.to, code: c.code, expiresAt } })
    return
  }
  const message = c.purpose === 'sign_in' ? 'code.second_factor' : 'code.verify_phone'
  await queueSms(tx, { partnerId: c.partnerId, storeId: null, idempotencyKey: c.idempotencyKey, payload: { message, to: c.to, brand: await c.brand(), vars: { code: c.code }, expiresAt } })
}
