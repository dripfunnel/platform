import type { z } from 'zod'
import { PaymentRefused, PaymentUnavailable, paymentTimeoutMs } from '#core/payments'

// One call to a payment provider, as every adapter here makes it: a timeout, the provider being down or throttling told
// apart from it refusing the merchant's keys, and the answer read through a schema or not at all.

export const callProvider = async <S extends z.ZodType>(fetchImpl: typeof fetch, url: string, init: RequestInit, schema: S, allow: readonly number[] = []): Promise<z.infer<S>> => {
  let response: Response
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(paymentTimeoutMs) })
  } catch {
    throw new PaymentUnavailable('no answer')
  }
  if (response.status >= 500 || response.status === 429) throw new PaymentUnavailable(`answered ${response.status}`)
  if (!response.ok && !allow.includes(response.status)) throw new PaymentRefused(`answered ${response.status}`)
  const json: unknown = await response.json().catch(() => null)
  const parsed = schema.safeParse(json)
  if (!parsed.success) throw new PaymentUnavailable('answered in a shape we do not read')
  return parsed.data
}

const hex = (bytes: ArrayBuffer) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

export const hmacSha256 = async (secret: string, message: string): Promise<ArrayBuffer> => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message))
}
export const hmacHex = async (secret: string, message: string) => hex(await hmacSha256(secret, message))
export const hmacBase64 = async (secret: string, message: string) => btoa(String.fromCharCode(...new Uint8Array(await hmacSha256(secret, message))))
export const sha256Hex = async (message: string) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(message)))

/** Compares two signatures in time that doesn't depend on where they differ. */
export const sameText = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/** Our attempt's id as an order reference the stricter providers take: letters, digits and underscores, under 40. */
export const referenceOf = (attemptId: string) => `df_${attemptId.replaceAll('-', '')}`
