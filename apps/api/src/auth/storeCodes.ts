import { hashWithOwnerSalt } from './password'
import { hashSessionId } from './session'

// The codes merchant sign-in hands out (ACCESS.md §4): ten backup codes per enrolment, and 6-digit
// codes sent by WhatsApp or SMS for sign-in or to confirm a number. All stored hashed, never shown twice.

export const backupCodeCount = 10
export const smsCodeMs = 10 * 60 * 1000
export const maxSmsCodeAttempts = 5
/** Texts per person in any 10 minutes, so a code request can't flood a phone or a bill. */
export const maxSmsCodesPer10Min = 3

const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789'

const randomFrom = (chars: string, length: number): string =>
  Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => chars[b % chars.length]).join('')

/** `xxxx-xxxx`, 40 bits each from an alphabet without look-alikes. */
export const newBackupCodes = (): string[] => Array.from({ length: backupCodeCount }, () => `${randomFrom(alphabet, 4)}-${randomFrom(alphabet, 4)}`)

export const normaliseBackupCode = (typed: string): string => typed.trim().toLowerCase().replaceAll(/\s/g, '')

// Salted by the person and slow, since 40 bits would fall offline to a bare hash.
export const hashBackupCode = (userId: string, code: string): Promise<string> => hashWithOwnerSalt(normaliseBackupCode(code), `backup:${userId}`)

export const newSmsCode = (): string => {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return String(value % 1_000_000).padStart(6, '0')
}

// Salted by the code's own row, so the same digits never hash alike across rows.
export const hashSmsCode = (rowSalt: string, code: string): Promise<string> => hashSessionId(`sms:${rowSalt}:${code.trim()}`)

/** `•••• 2113`: enough to recognise the number, never the number. */
export const phoneHint = (phone: string): string => `•••• ${phone.slice(-4)}`

export const codeChannels = ['whatsapp', 'sms'] as const
export type CodeChannel = (typeof codeChannels)[number]
/** Which channels reach a number now (ACCESS.md §4): the partner's WhatsApp, and SMS for the number's route. */
export type OpenCodeChannels = Record<CodeChannel, boolean>

/** After a code goes by WhatsApp, an SMS for the same purpose waits this long (ACCESS.md §4). */
export const smsAfterWhatsAppMs = 20_000

export type ChannelRefusal = { code: 'CHANNEL_OFF' } | { code: 'TOO_SOON'; seconds: number }

/** The asked channel, else WhatsApp while it is open, else SMS; refused when closed, or SMS within 20 s of a WhatsApp send. */
export const chooseCodeChannel = (asked: CodeChannel | undefined, open: OpenCodeChannels, last: { channel: CodeChannel; sentAt: Date } | null, now: Date): CodeChannel | ChannelRefusal => {
  const channel = asked ?? (open.whatsapp ? 'whatsapp' : 'sms')
  if (!open[channel]) return { code: 'CHANNEL_OFF' }
  const waited = last?.channel === 'whatsapp' ? now.getTime() - last.sentAt.getTime() : Infinity
  if (channel === 'sms' && waited < smsAfterWhatsAppMs) return { code: 'TOO_SOON', seconds: Math.ceil((smsAfterWhatsAppMs - waited) / 1000) }
  return channel
}
