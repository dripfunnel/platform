// The signed preview link's token (storefront PREVIEW.md §5 step 1): the store, the issuer, the store's revocation number
// and the expiry, sealed with AES-GCM under a key derived from PREVIEW_LINK_KEY. Sealed, not only signed, because the
// link is passed around and the issuer's id must never reach its holder (§5 step 5).

/** Decided on #317 (PREVIEW §8): the link opens a session for 7 days after it was issued. */
export const previewLinkSeconds = 7 * 24 * 60 * 60

export interface PreviewGrant {
  storeId: string
  userId: string
  epoch: number
  /** Seconds since the epoch. */
  expiresAt: number
}

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]{1,2048}$/.test(text)) return null
  try {
    return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/

const isGrant = (value: unknown): value is PreviewGrant => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return typeof v['storeId'] === 'string' && uuid.test(v['storeId']) && typeof v['userId'] === 'string' && uuid.test(v['userId']) && Number.isSafeInteger(v['epoch']) && Number.isSafeInteger(v['expiresAt'])
}

export interface PreviewLinks {
  seal: (grant: PreviewGrant) => Promise<string>
  /** The grant, only when the token is ours and untouched; its expiry and store are the caller's to check. */
  open: (token: string) => Promise<PreviewGrant | null>
}

export const previewLinks = async (keyBase64: string): Promise<PreviewLinks> => {
  const base = await crypto.subtle.importKey('raw', Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0)), 'HKDF', false, ['deriveKey'])
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(32), info: new TextEncoder().encode('dripfunnel:preview-links:v1') },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
  return {
    seal: async (grant) => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(grant))))
      const out = new Uint8Array(iv.length + sealed.length)
      out.set(iv)
      out.set(sealed, iv.length)
      return toBase64Url(out)
    },
    open: async (token) => {
      const bytes = fromBase64Url(token)
      if (!bytes || bytes.length < 29) return null
      try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
        const parsed: unknown = JSON.parse(new TextDecoder().decode(plain))
        return isGrant(parsed) ? parsed : null
      } catch {
        return null
      }
    },
  }
}
