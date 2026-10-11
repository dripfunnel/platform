// The preview session cookie (storefront PREVIEW.md §5 step 2): sealed by this Worker with PREVIEW_SESSION_KEY, naming the
// preview key, the store, the issuer, the revocation number and the change folder, for 15 minutes.

export const sessionCookie = '__Host-df_preview'
export const sessionSeconds = 15 * 60

export interface PreviewSession {
  /** The host's preview key. */
  k: string
  /** The store. */
  s: string
  /** The user who issued the link; never sent on to the API or the page (PREVIEW §5 step 5). */
  u: string
  /** storefront.preview_epoch when the link was issued. */
  e: number
  /** The change folder the last checked page came from, which its chunks are read from. */
  f: string
  /** Expiry, in seconds since the epoch. */
  x: number
}

const toBase64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromBase64Url = (text: string): Uint8Array<ArrayBuffer> | null => {
  if (!/^[A-Za-z0-9_-]{1,4096}$/.test(text)) return null
  try {
    return Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
}

const isSession = (value: unknown): value is PreviewSession => {
  if (typeof value !== 'object' || value === null) return false
  const v = value as Record<string, unknown>
  return (
    typeof v['k'] === 'string' &&
    typeof v['s'] === 'string' &&
    typeof v['u'] === 'string' &&
    typeof v['f'] === 'string' &&
    Number.isSafeInteger(v['e']) &&
    Number.isSafeInteger(v['x'])
  )
}

export interface SessionSeal {
  write: (session: PreviewSession) => Promise<string>
  /** The session, only when it is ours and untouched; its expiry and host are the caller's to check. */
  read: (value: string) => Promise<PreviewSession | null>
}

/** Sealed with AES-GCM, not only signed: the cookie names the link's issuer, whom its holder must not learn (PREVIEW §5 step 5). */
export const sessionSeal = async (keyBase64: string): Promise<SessionSeal> => {
  const raw = Uint8Array.from(atob(keyBase64), (c) => c.charCodeAt(0))
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt'])
  return {
    write: async (session) => {
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(session))))
      const out = new Uint8Array(iv.length + sealed.length)
      out.set(iv)
      out.set(sealed, iv.length)
      return toBase64Url(out)
    },
    read: async (value) => {
      const bytes = fromBase64Url(value)
      if (!bytes || bytes.length < 29) return null
      try {
        const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes.slice(0, 12) }, key, bytes.slice(12))
        const parsed: unknown = JSON.parse(new TextDecoder().decode(plain))
        return isSession(parsed) ? parsed : null
      } catch {
        return null
      }
    },
  }
}

export const cookieValue = (request: Request, name: string): string | null => {
  for (const part of (request.headers.get('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === name) return v.join('=')
  }
  return null
}

/** The request as the API should see it: without the preview cookie, so the issuer never reaches it (PREVIEW §5 step 5). */
export const withoutCookie = (request: Request, name: string): Request => {
  const kept = (request.headers.get('cookie') ?? '')
    .split(';')
    .map((p) => p.trim())
    .filter((p) => p !== '' && p.split('=')[0] !== name)
  const headers = new Headers(request.headers)
  if (kept.length > 0) headers.set('cookie', kept.join('; '))
  else headers.delete('cookie')
  return new Request(request, { headers })
}

export const setCookie = (value: string) => `${sessionCookie}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${sessionSeconds}`
