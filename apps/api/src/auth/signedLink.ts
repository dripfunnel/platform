// Links that carry their own proof, such as a paid order's download (CATALOG-DESIGN T14): an HMAC over what the link
// names, under a key derived from CREDENTIALS_KEK with HKDF, so no new secret and no token kept to show the link again.

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))
const toBase64Url = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]{43}$/.test(text)) return null
  return fromBase64(text.replaceAll('-', '+').replaceAll('_', '/') + '=')
}

export interface LinkSigner {
  sign: (message: string) => Promise<string>
  /** Constant-time, through WebCrypto's own verify. */
  verify: (message: string, signature: string) => Promise<boolean>
}

export const linkSigner = async (keyBase64: string, purpose: string): Promise<LinkSigner> => {
  const base = await crypto.subtle.importKey('raw', fromBase64(keyBase64), 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode(`dripfunnel:${purpose}:v1`) },
    base,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    false,
    ['sign', 'verify'],
  )
  const bytes = (message: string) => new TextEncoder().encode(message)
  return {
    sign: async (message) => toBase64Url(new Uint8Array(await crypto.subtle.sign('HMAC', key, bytes(message)))),
    verify: async (message, signature) => {
      const raw = fromBase64Url(signature)
      return raw !== null && crypto.subtle.verify('HMAC', key, raw, bytes(message))
    },
  }
}
