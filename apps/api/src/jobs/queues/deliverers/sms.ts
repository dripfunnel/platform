import type postgres from 'postgres'
import { logEvent } from '#core/log'
import { SmsRefused, type SmsSender } from '#core/sms'
import { withSystemScope } from '#db/scoped/index'
import type { Msg91Credentials } from '#integrations/msg91/index'
import type { TwilioCredentials } from '#integrations/twilio/index'
import { composeSms, providerFor, smsPayloadSchema, type PartnerSmsAccounts } from '#saas/sms/index'
import type { Deliverer } from '../outbox-relay'

export interface SmsSenders {
  msg91: (credentials: Msg91Credentials) => SmsSender
  twilio: (credentials: TwilioCredentials) => SmsSender
}

/**
 * `sms`: one outbox row, one text through the partner's own account for the number's country
 * (THIRD-PARTY-ACCESS §2.8). A provider's outage is retried with the outbox's backoff; a refusal,
 * a missing account or template, and an expired code are dropped and logged, since sending later
 * can't help. Neither the number nor the code is ever logged.
 */
export const smsDeliverer = (sql: postgres.Sql, accounts: PartnerSmsAccounts, senders: SmsSenders, now: () => Date = () => new Date()): Deliverer => ({
  deliver: async (effect, signal) => {
    const log = (event: string, code: string) => logEvent({ event, api: 'system', partnerId: effect.partnerId, storeId: effect.storeId, code })
    const parsed = smsPayloadSchema.safeParse(effect.payload)
    if (!parsed.success || !effect.partnerId) return log('sms_skipped', 'bad_payload')
    const payload = parsed.data
    if (payload.expiresAt && new Date(payload.expiresAt) <= now()) return log('sms_skipped', 'expired')
    const provider = providerFor(payload.to)
    const partnerId = effect.partnerId
    const account = await withSystemScope(sql, (tx) => accounts.forPartner(tx, partnerId, provider))
    if (!account || account.provider !== provider) return log('sms_skipped', `no_${provider}_account`)
    const templateId = account.provider === 'msg91' ? (account.templates[payload.message] ?? null) : null
    if (account.provider === 'msg91' && !templateId) return log('sms_skipped', 'no_dlt_template')
    const sender = account.provider === 'msg91' ? senders.msg91({ authKey: account.authKey }) : senders.twilio(account)
    try {
      await sender.send(composeSms(payload, templateId), signal)
    } catch (error) {
      if (error instanceof SmsRefused) return log('sms_refused', error.code)
      throw error
    }
    log('sms_sent', provider)
  },
})
