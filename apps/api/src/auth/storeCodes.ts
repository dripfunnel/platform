import { hashSessionId } from './session'

// The codes merchant sign-in hands out (ACCESS.md §4): ten backup codes per enrolment, and 6-digit
// codes texted for sign-in or to confirm a number. All stored hashed, never shown twice.

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

export const hashBackupCode = (code: string): Promise<string> => hashSessionId(`backup:${normaliseBackupCode(code)}`)

export const newSmsCode = (): string => {
  const value = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return String(value % 1_000_000).padStart(6, '0')
}

// Salted by the code's own row, so the same digits never hash alike across rows.
export const hashSmsCode = (rowSalt: string, code: string): Promise<string> => hashSessionId(`sms:${rowSalt}:${code.trim()}`)

/** `•••• 2113`: enough to recognise the number, never the number. */
export const phoneHint = (phone: string): string => `•••• ${phone.slice(-4)}`
