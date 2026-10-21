// The one contract every SMS provider adapter keeps (THIRD-PARTY-ACCESS §2.8): MSG91 in India,
// Twilio elsewhere, each the partner's own account (#272).

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
