import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { SmsRefused, type SmsSender } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import type { Msg91Credentials } from '#integrations/msg91/index'
import type { TwilioCredentials } from '#integrations/twilio/index'
import { composeSms, providerFor, smsPayloadSchema, type PartnerSmsAccounts } from '#saas/sms/index'
import { GiveUp, type Deliverer } from '../outbox-relay'

export interface SmsSenders {
  msg91: (credentials: Msg91Credentials) => SmsSender
  twilio: (credentials: TwilioCredentials) => SmsSender
}

/** `sms` (THIRD-PARTY-ACCESS §2.8, §4). Neither provider takes an idempotency key, so a crash after it accepts can text twice. */
export const smsDeliverer = (sql: postgres.Sql, accounts: PartnerSmsAccounts, senders: SmsSenders, now: () => Date = () => new Date()): Deliverer => ({
  // Sent, dropped or dead: the code and the number leave the row, the message kind stays.
  redact: (payload) => {
    const message = (payload as { message?: unknown } | null)?.message
    return { message: typeof message === 'string' ? message : null, redacted: true }
  },
  deliver: async (effect, signal) => {
    const log = (event: string, code: string) => logEvent({ event, api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code })
    // Dropped, not delivered: the row says it was given up and why (outbox-relay.ts GiveUp).
    const drop = (event: string, code: string): never => {
      log(event, code)
      throw new GiveUp(code)
    }
    const parsed = smsPayloadSchema.safeParse(effect.payload)
    if (!parsed.success || !effect.partnerId) return drop('sms_skipped', 'bad_payload')
    const payload = parsed.data
    if (payload.expiresAt && new Date(payload.expiresAt) <= now()) return drop('sms_skipped', 'expired')
    const provider = providerFor(payload.to)
    const partnerId = effect.partnerId
    const account = await withSystemScope(sql, (tx) => accounts.forPartner(tx, partnerId, provider))
    if (!account || account.provider !== provider) return drop('sms_skipped', `no_${provider}_account`)
    const templateId = account.provider === 'msg91' ? (account.templates[payload.message] ?? null) : null
    if (account.provider === 'msg91' && !templateId) return drop('sms_skipped', 'no_dlt_template')
    const sender = account.provider === 'msg91' ? senders.msg91({ authKey: account.authKey }) : senders.twilio(account)
    try {
      await sender.send(composeSms(payload, templateId), signal)
    } catch (error) {
      if (error instanceof SmsRefused) return drop('sms_refused', error.code)
      throw error
    }
    log('sms_sent', provider)
  },
})
