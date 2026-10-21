// Stripe's webhook signature (`Stripe-Signature: t=…,v1=…`): HMAC-SHA256 of `{t}.{body}` with the
// endpoint's signing secret, within five minutes of `t` (SAAS §7.2).
export const signatureToleranceSeconds = 300

const encoder = new TextEncoder()

const hex = (bytes: ArrayBuffer): string => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('')

/** Constant time over equal lengths; the lengths themselves are public (64 hex characters). */
const same = (a: string, b: string): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export const signPayload = async (secret: string, timestamp: number, body: string): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(`${timestamp}.${body}`)))
}

export const verifySignature = async (body: string, header: string | null, secret: string, now: Date): Promise<boolean> => {
  if (!header) return false
  const parts = header.split(',').map((p) => p.split('=', 2) as [string, string | undefined])
  const timestamp = Number(parts.find(([k]) => k === 't')?.[1])
  const signatures = parts.filter(([k, v]) => k === 'v1' && v !== undefined).map(([, v]) => v ?? '')
  if (!Number.isInteger(timestamp) || signatures.length === 0) return false
  if (Math.abs(now.getTime() / 1000 - timestamp) > signatureToleranceSeconds) return false
  const expected = await signPayload(secret, timestamp, body)
  return signatures.some((s) => same(s, expected))
}
