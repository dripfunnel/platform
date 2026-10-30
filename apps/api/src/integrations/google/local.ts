import { SignInFailed } from '#auth/oidc'
import type { GoogleClaims, GoogleSignIn } from './provider'

// GOOGLE_SIGN_IN_LOCAL=1 (local only, docs/setup/local.md): a page on the portal host plays Google, so the
// sign-in and sign-up can be walked through with no Google client. Its "code" and "ID token" carry the claims.

export const localGooglePath = '/api/auth/google/local'

const encode = (claims: GoogleClaims & { nonce: string | null }) => btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(claims))))

const decode = (value: string): (GoogleClaims & { nonce: string | null }) | null => {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))))
    if (typeof parsed !== 'object' || parsed === null) return null
    const { email, name, nonce } = parsed as Record<string, unknown>
    if (typeof email !== 'string' || !email.includes('@')) return null
    return { email, name: typeof name === 'string' ? name : '', nonce: typeof nonce === 'string' ? nonce : null }
  } catch {
    return null
  }
}

export const localGoogleSignIn = (): GoogleSignIn => ({
  // Paths only: wrangler dev rewrites an absolute address on its own host to http, which Caddy doesn't answer.
  authorizeUrl: ({ redirectUri, state, nonce }) => `${localGooglePath}?${new URLSearchParams({ redirect_uri: redirectUri, state, nonce })}`,
  exchange: async ({ code, nonce }) => {
    const claims = decode(code)
    if (!claims || claims.nonce !== nonce) throw new SignInFailed('bad_claims')
    return { email: claims.email, name: claims.name }
  },
  verify: async (idToken) => {
    const claims = decode(idToken.replace(/^local\./, ''))
    if (!claims) throw new SignInFailed('bad_claims')
    return { email: claims.email, name: claims.name }
  },
})

const escape = (text: string) => text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** The stand-in's own page: an address and a name, then back to the callback as Google would send it. */
export const localGooglePage = (url: URL): Response => {
  const redirectUri = url.searchParams.get('redirect_uri') ?? ''
  const state = url.searchParams.get('state') ?? ''
  const nonce = url.searchParams.get('nonce') ?? ''
  // The host, not the origin: behind Caddy the Worker sees http.
  if (new URL(redirectUri, url).host !== url.host) return new Response('Bad redirect', { status: 400 })
  const email = url.searchParams.get('email')
  if (email !== null) {
    const back = new URL(redirectUri, url)
    if (url.searchParams.get('cancel') === '1') back.searchParams.set('error', 'access_denied')
    else back.searchParams.set('code', encode({ email, name: url.searchParams.get('name') ?? '', nonce }))
    back.searchParams.set('state', state)
    return new Response(null, { status: 302, headers: { location: `${back.pathname}${back.search}` } })
  }
  const hidden = Object.entries({ redirect_uri: redirectUri, state, nonce })
    .map(([k, v]) => `<input type="hidden" name="${k}" value="${escape(v)}">`)
    .join('')
  const html = `<!doctype html><meta charset="utf-8"><title>Local Google</title><body style="font-family:sans-serif;max-width:360px;margin:48px auto">
<h1>Local Google</h1><p>Stands in for Google on this machine (GOOGLE_SIGN_IN_LOCAL).</p>
<form>${hidden}<p><label>Email<br><input name="email" type="email" required></label></p><p><label>Name<br><input name="name"></label></p>
<button>Continue</button> <button name="cancel" value="1" formnovalidate>Cancel</button></form></body>`
  return new Response(html, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } })
}
