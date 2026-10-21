import { z } from 'zod'
import type { CardProvider, PaymentMode } from '#core/payments'

// What each provider's merchant pastes in Payment setup (THIRD-PARTY-ACCESS §3.1), checked before anything is sent to the
// provider or sealed. Unknown fields are refused. Stripe pastes nothing: it connects by OAuth.

const text = (max: number) => z.string().trim().min(1).max(max)

const schemas = {
  razorpay: z.strictObject({ keyId: z.string().trim().regex(/^rzp_(test|live)_[A-Za-z0-9]{6,40}$/), keySecret: text(100), webhookSecret: text(200) }),
  cashfree: z.strictObject({ appId: text(100), secretKey: text(200) }),
  phonepe: z.strictObject({ clientId: text(100), clientSecret: text(200), clientVersion: z.string().trim().regex(/^\d{1,4}$/), webhookUsername: text(100), webhookPassword: text(200) }),
  paypal: z.strictObject({ clientId: text(200), clientSecret: text(200), webhookId: z.string().trim().regex(/^[A-Z0-9]{5,40}$/) }),
} as const

export type KeyedProvider = keyof typeof schemas
export const isKeyedProvider = (p: CardProvider): p is KeyedProvider => p in schemas

export interface CleanCredentials {
  credentials: Record<string, string>
  /** What a storefront may hold: Razorpay's key id, PayPal's client id. */
  publicKey: string | null
}

/** The keys for this provider and mode, or null when they aren't its shape (a Razorpay key of the other mode included). */
export const cleanCredentials = (provider: KeyedProvider, mode: PaymentMode, input: Record<string, string | null | undefined>): CleanCredentials | null => {
  const given = Object.fromEntries(Object.entries(input).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''))
  const parsed = schemas[provider].safeParse(given)
  if (!parsed.success) return null
  const credentials: Record<string, string> = { ...parsed.data }
  if (provider === 'razorpay' && !credentials['keyId']?.startsWith(`rzp_${mode}_`)) return null
  return { credentials, publicKey: provider === 'razorpay' ? (credentials['keyId'] ?? null) : provider === 'paypal' ? (credentials['clientId'] ?? null) : null }
}
