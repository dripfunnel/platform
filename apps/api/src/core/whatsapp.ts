// The one contract a WhatsApp adapter keeps (THIRD-PARTY-ACCESS §2.8): a template the partner's WhatsApp Business account
// had approved, filled with its variables in order. Free text is never sent. Failures use core/sms's two errors.

export interface OutgoingWhatsApp {
  /** E.164, `+` and digits only. */
  to: string
  /** The approved template's name and language, as the partner registered it. */
  template: string
  language: string
  vars: readonly string[]
}

export interface WhatsAppSender {
  send: (message: OutgoingWhatsApp, signal?: AbortSignal) => Promise<{ providerId: string }>
}
