import { z } from 'zod'

// The one contract every SMS provider adapter keeps (THIRD-PARTY-ACCESS §2.8): MSG91 in India, Twilio elsewhere,
// DripFunnel's own accounts unless the partner's is complete (#1017).

/** What the platform texts; each is one DLT template in India (THIRD-PARTY-ACCESS §4). */
export const smsMessages = ['code.second_factor', 'code.verify_phone', 'code.shopper_sign_in', 'order.confirmed', 'order.shipped', 'order.delivered', 'rider.invited'] as const
export type SmsMessage = (typeof smsMessages)[number]

// The shapes each provider issues, checked at boot for DripFunnel's values and on save for a partner's.
export const msg91AuthKeySchema = z.string().regex(/^[A-Za-z0-9]{16,64}$/, 'an MSG91 auth key')
/** MSG91's Flow template id for each message, all seven. */
export const msg91TemplatesSchema = z.record(z.enum(smsMessages), z.string().regex(/^[A-Za-z0-9_-]{1,64}$/, 'an MSG91 template id'))
export const twilioAccountSidSchema = z.string().regex(/^AC[0-9a-f]{32}$/, 'a Twilio account SID')
export const twilioAuthTokenSchema = z.string().regex(/^[0-9a-f]{32}$/, 'a Twilio auth token')
export const twilioMessagingServiceSidSchema = z.string().regex(/^MG[0-9a-f]{32}$/, 'a Twilio messaging service SID')

export const smsProviders = ['msg91', 'twilio'] as const
export type SmsProvider = (typeof smsProviders)[number]

/** A credential check that sends nothing (#1017): the provider accepted it, refused it, or didn't answer. */
export type SmsAccountCheck = 'ok' | 'rejected' | 'unavailable'

export interface OutgoingSms {
  /** E.164, `+` and digits only. */
  to: string
  /** The full text, in the sender's voice and the reader's language. */
  text: string
  /**
   * India's DLT (TRAI): the registered template the text was filled from, and its variables in
   * order. MSG91 sends the template, never free text; null where no DLT applies.
   */
  dlt: { templateId: string; vars: readonly string[] } | null
}

export interface SmsSender {
  send: (sms: OutgoingSms, signal?: AbortSignal) => Promise<{ providerId: string }>
}

/** The provider didn't answer in time, throttled or failed itself: the outbox tries again later. */
export class SmsUnavailable extends Error {
  override name = 'SmsUnavailable'
}

/** The provider refused this message (a bad number, an unregistered template). `code` is the provider's, safe to log. */
export class SmsRefused extends Error {
  override name = 'SmsRefused'
  constructor(readonly code: string) {
    super(`sms refused: ${code}`)
  }
}

export const smsTimeoutMs = 8_000

const e164 = /^\+[1-9]\d{6,14}$/

export const isE164 = (value: string): boolean => e164.test(value)
