// The credential key-encryption key (THIRD-PARTY-ACCESS.md §5): AES-256-GCM, a fresh 12-byte
// IV per value, stored as `v1.<iv>.<ciphertext>` so a rotation can tell old values from new.
const toBase64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes))
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => Uint8Array.from(atob(text), (c) => c.charCodeAt(0))

export interface SecretBox {
  seal: (plain: string) => Promise<string>
  open: (sealed: string) => Promise<string | null>
}

export const secretBox = async (keyBase64: string): Promise<SecretBox> => {
  const key = await crypto.subtle.importKey('raw', fromBase64(keyBase64), 'AES-GCM', false, ['encrypt', 'decrypt'])
  return {
    seal: async (plain) => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plain)))
      return `v1.${toBase64(iv)}.${toBase64(sealed)}`
    },
    open: async (sealed) => {
      const [version, iv, body] = sealed.split('.')
      if (version !== 'v1' || !iv || !body) return null
      try {
        return new TextDecoder().decode(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromBase64(iv) }, key, fromBase64(body)))
      } catch {
        return null
      }
    },
  }
}
