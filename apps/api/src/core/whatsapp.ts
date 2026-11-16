// The one contract a WhatsApp adapter keeps (THIRD-PARTY-ACCESS §2.8): a template the partner's WhatsApp Business account
// had approved, filled with its variables in order. Free text is never sent. Failures use core/sms's two errors.

export interface OutgoingWhatsApp {
  /** E.164, `+` and digits only. */
  to: string
  /** The approved template's name and language, as the partner registered it. */
  template: string
  language: string
  vars: readonly string[]
  /** An authentication template's Copy code button: the code it copies. */
  copyCode?: string
}

export interface WhatsAppSender {
  send: (message: OutgoingWhatsApp, signal?: AbortSignal) => Promise<{ providerId: string }>
}

/** A read-only check of an account (#1504): which part Meta refused, or that it couldn't be asked. Nothing is sent. */
export type WhatsAppAccountCheck =
  | { status: 'ok' }
  | { status: 'unavailable' }
  | { status: 'rejected'; problem: 'token' | 'phone_number' | 'business_account' }
  | { status: 'rejected'; problem: 'template'; template: string }
