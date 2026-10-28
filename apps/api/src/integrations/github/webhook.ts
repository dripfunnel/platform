// The GitHub App's webhook (#968; THIRD-PARTY-ACCESS.md §2.3): each delivery carries `x-hub-signature-256`, the body's
// HMAC-SHA256 under the App's webhook secret.

const hex = (value: string): Uint8Array<ArrayBuffer> | null => (/^(?:[0-9a-f]{2})+$/.test(value) ? new Uint8Array(value.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []) : null)

/** Checked in constant time by WebCrypto, on the raw body before anything parses it. */
export const verifyWebhookSignature = async (body: Uint8Array<ArrayBuffer>, header: string | null, secret: string): Promise<boolean> => {
  const signature = header?.startsWith('sha256=') ? hex(header.slice(7)) : null
  if (!signature || signature.length !== 32) return false
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'])
  return crypto.subtle.verify('HMAC', key, signature, body)
}
