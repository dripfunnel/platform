import { z } from 'zod'

// The one contract every SMS provider adapter keeps (THIRD-PARTY-ACCESS §2.8): MSG91 in India,
// Twilio elsewhere, DripFunnel's own account or the partner's (#1017).

/** The seven texts the platform sends; each is a DLT template in India, so a provider account needs one id per message (THIRD-PARTY-ACCESS §4). */
export const smsMessages = ['code.second_factor', 'code.verify_phone', 'code.shopper_sign_in', 'order.confirmed', 'order.shipped', 'order.delivered', 'rider.invited'] as const
export type SmsMessage = (typeof smsMessages)[number]

/** MSG91 for Indian numbers (DLT), Twilio for the rest (decided on #284). */
export const smsProviders = ['msg91', 'twilio'] as const
export type SmsProvider = (typeof smsProviders)[number]

/** What a provider said of an account when asked to confirm it, without a text being sent. */
export type SmsAccountCheck = 'ok' | 'rejected' | 'unavailable'

// The shapes of a provider account's parts (THIRD-PARTY-ACCESS §8.3), shared by the Worker's own values and a partner's saved account.
export const msg91AuthKey = z.string().regex(/^[A-Za-z0-9_-]{16,128}$/, 'an MSG91 auth key')
export const msg91TemplateId = z.string().regex(/^[A-Za-z0-9_-]{6,64}$/, 'an MSG91 template id')
/** One MSG91 template id for every message kind: an incomplete set is never an account. */
export const msg91Templates = z.strictObject(Object.fromEntries(smsMessages.map((message) => [message, msg91TemplateId])) as Record<SmsMessage, typeof msg91TemplateId>)
export const twilioAccountSid = z.string().regex(/^AC[0-9a-f]{32}$/i, 'a Twilio account SID')
export const twilioAuthToken = z.string().regex(/^[0-9a-f]{32}$/i, 'a Twilio auth token')
export const twilioMessagingServiceSid = z.string().regex(/^MG[0-9a-f]{32}$/i, 'a Twilio messaging service SID')

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
