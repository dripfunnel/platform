import { z } from 'zod'
import { factsOf, personSignInRefused, type RequestFacts } from '#auth/activity'
import { originAllowed, readCookie } from '#auth/cookie'
import { safeNext } from '#auth/next'
import { SignInFailed, type SignInRefusal } from '#auth/oidc'
import { wantsBodySession } from '#auth/storeCredential'
import { setStoreCookie } from '#auth/storeSession'
import { minutesUntil } from '#auth/partnerCode'
import { selectGoogleClient } from '#db/scoped/googleSignIn'
import { withSystemScope } from '#db/scoped/index'
import { selectSignInCandidate } from '#db/scoped/userSignIn'
import { localGooglePage, localGooglePath } from '#integrations/google/local'
import type { GoogleClaims, GoogleSignIn } from '#integrations/google/provider'
import { admit, withSession, type Admission, type StoreAuthDeps } from './admission'
import { readBody, refuse } from './authHttp'
import { openGoogleSignup, resumeSignup, signupCookieName } from './signup'

// "Continue with Google" on a partner's portal host, on the partner's own client (ACCESS.md §2; #1046).
// Google only proves the address: what opens is what a password would open, second factor and lock included.

export interface StoreGoogleDeps extends StoreAuthDeps {
  google: GoogleSignIn
  /** GOOGLE_SIGN_IN_LOCAL: the stand-in page answers on this host. */
  local: boolean
}

const paths = {
  start: '/api/auth/google/start',
  callback: '/api/auth/google/callback',
  token: '/api/auth/google/token',
  resume: '/api/auth/sign-up/resume',
}

export const isStoreGooglePath = (pathname: string): boolean => Object.values(paths).includes(pathname) || pathname === localGooglePath

type Intent = 'sign-in' | 'sign-up'
type Outcome = 'no-account' | 'cancelled' | 'unavailable' | 'refused' | 'locked' | 'closed' | 'busy'

const handshakeCookie = '__Host-df_google'
const handshakeMs = 10 * 60_000
const clearHandshake = () => `${handshakeCookie}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
const challengeOf = async (verifier: string) => base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))))

const decodePath = (encoded: string | undefined): string => {
  try {
    return encoded ? new TextDecoder().decode(Uint8Array.from(atob(encoded.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))) : '/'
  } catch {
    return '/'
  }
}

// The intent and the page to return to ride in the cookie, never the query, so a callback can't be turned into the other flow.
const readHandshake = (header: string | null): { state: string; nonce: string; verifier: string; intent: Intent; next: string } | null => {
  const [state, nonce, verifier, intent, next] = readCookie(header, handshakeCookie)?.split('.') ?? []
  if (!state || !nonce || !verifier || (intent !== 'sign-in' && intent !== 'sign-up')) return null
  return { state, nonce, verifier, intent, next: decodePath(next) }
}

const redirect = (location: string, ...cookies: string[]) => {
  const headers = new Headers({ location })
  for (const cookie of [...cookies, clearHandshake()]) headers.append('set-cookie', cookie)
  return new Response(null, { status: 302, headers })
}

const refused = (intent: Intent, outcome: Outcome) => redirect(`/${intent}?outcome=${outcome}`)

const outcomeOf = (refusal: SignInRefusal): Outcome =>
  refusal === 'user_cancelled' ? 'cancelled' : refusal === 'provider_unavailable' || refusal === 'provider_unconfigured' ? 'unavailable' : 'refused'

const redirectUri = (host: string) => `https://${host}${paths.callback}`

/** The partner's client while it's on, its secret opened; null when Google sign-in isn't offered here. */
const clientFor = async (deps: StoreGoogleDeps) => {
  const row = await withSystemScope(deps.sql, (tx) => selectGoogleClient(tx, deps.partnerId))
  if (!row) return null
  const clientSecret = deps.secrets ? await deps.secrets.open(row.secret_enc) : null
  return clientSecret ? { clientId: row.client_id, clientSecret } : null
}

/** An account of this partner that finished joining (selectSignInCandidate reads active ones only); Google never accepts an invitation. */
const admitGoogle = (deps: StoreGoogleDeps, facts: RequestFacts, claims: GoogleClaims) =>
  withSystemScope(deps.sql, async (tx): Promise<Admission | 'no-account' | { locked: number }> => {
    const now = deps.now()
    const candidate = await selectSignInCandidate(tx, deps.partnerId, claims.email)
    if (!candidate) {
      await deps.activity.record(tx, personSignInRefused(deps.partnerId, facts, 'google_no_account'))
      return 'no-account'
    }
    if (candidate.locked_until && candidate.locked_until > now) {
      await deps.activity.record(tx, personSignInRefused(deps.partnerId, facts, 'locked'))
      return { locked: minutesUntil(candidate.locked_until, now) }
    }
    return admit(tx, deps, facts, candidate, false, now, 'google')
  })

const start = async (url: URL, deps: StoreGoogleDeps): Promise<Response> => {
  const intent: Intent = url.searchParams.get('intent') === 'sign-up' ? 'sign-up' : 'sign-in'
  const client = await withSystemScope(deps.sql, (tx) => selectGoogleClient(tx, deps.partnerId))
  if (!client) return refused(intent, 'unavailable')
  const state = crypto.randomUUID()
  const nonce = crypto.randomUUID()
  const verifier = base64url(crypto.getRandomValues(new Uint8Array(32)))
  const next = base64url(new TextEncoder().encode(safeNext(url.searchParams.get('next'), url.origin, '/')))
  const location = deps.google.authorizeUrl({ clientId: client.client_id, redirectUri: redirectUri(deps.host), state, nonce, codeChallenge: await challengeOf(verifier) })
  const headers = new Headers({ location })
  headers.append('set-cookie', `${handshakeCookie}=${state}.${nonce}.${verifier}.${intent}.${next}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${handshakeMs / 1000}`)
  return new Response(null, { status: 302, headers })
}

const callback = async (request: Request, url: URL, deps: StoreGoogleDeps, facts: RequestFacts): Promise<Response> => {
  const handshake = readHandshake(request.headers.get('cookie'))
  if (!handshake) return refused('sign-in', 'refused')
  const { intent } = handshake
  // `state` before anything else Google sent, the error included (RFC 6749 §4.1.2.1).
  if (handshake.state !== url.searchParams.get('state')) return refused(intent, 'refused')
  const error = url.searchParams.get('error')
  if (error) return refused(intent, error === 'access_denied' ? 'cancelled' : 'unavailable')
  const code = url.searchParams.get('code')
  if (!code) return refused(intent, 'refused')
  const client = await clientFor(deps)
  if (!client) return refused(intent, 'unavailable')
  let claims: GoogleClaims
  try {
    claims = await deps.google.exchange({ client, code, redirectUri: redirectUri(deps.host), codeVerifier: handshake.verifier, nonce: handshake.nonce })
  } catch (failure) {
    const reason = failure instanceof SignInFailed ? failure.refusal : 'provider_unavailable'
    if (reason !== 'user_cancelled' && reason !== 'provider_unavailable') await withSystemScope(deps.sql, (tx) => deps.activity.record(tx, personSignInRefused(deps.partnerId, facts, 'google_refused')))
    return refused(intent, outcomeOf(reason))
  }
  // A sign-up whose address already has an account signs that account in: Google proved the address is theirs.
  const admitted = await admitGoogle(deps, facts, claims)
  if (admitted === 'no-account') {
    if (intent === 'sign-in') return refused('sign-in', 'no-account')
    const opened = await openGoogleSignup(deps, claims)
    if (!opened.ok) return refused('sign-up', opened.code === 'SIGNUP_CLOSED' ? 'closed' : 'busy')
    return redirect('/sign-up?step=store', opened.cookie)
  }
  if ('locked' in admitted) return redirect(`/sign-in?outcome=locked&minutes=${admitted.locked}`)
  const cookie = setStoreCookie(admitted.session, admitted.remember, admitted.stage)
  if (admitted.stage === 'full') return redirect(safeNext(handshake.next, url.origin, '/'), cookie)
  return redirect(admitted.stage === 'enrol' ? '/sign-in?step=enrol' : `/sign-in?step=second-factor&method=${admitted.method ?? 'app'}`, cookie)
}

const tokenInput = z.strictObject({ idToken: z.string().min(1).max(4096) })

/** The merchant app's native Google sign-in: an ID token issued for the partner's web client, answered as the bearer routes are (ACCESS.md §4). */
const exchangeToken = async (request: Request, deps: StoreGoogleDeps, facts: RequestFacts): Promise<Response> => {
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  if (!wantsBodySession(request)) return new Response('Bad origin', { status: 403 })
  const input = await readBody(request, tokenInput)
  if (!input) return refuse({ code: 'INVALID_INPUT' })
  const client = await withSystemScope(deps.sql, (tx) => selectGoogleClient(tx, deps.partnerId))
  if (!client) return refuse({ code: 'GOOGLE_UNAVAILABLE' })
  let claims: GoogleClaims
  try {
    claims = await deps.google.verify(input.idToken, client.client_id)
  } catch {
    await withSystemScope(deps.sql, (tx) => deps.activity.record(tx, personSignInRefused(deps.partnerId, facts, 'google_refused')))
    return refuse({ code: 'GOOGLE_REFUSED' })
  }
  const admitted = await admitGoogle(deps, facts, claims)
  if (admitted === 'no-account') return refuse({ code: 'NO_ACCOUNT' })
  if ('locked' in admitted) return refuse({ code: 'LOCKED', minutes: admitted.locked })
  const body = { ok: true, step: admitted.stage === 'full' ? 'done' : admitted.stage, ...(admitted.stage === 'second-factor' ? { method: admitted.method } : {}) }
  return withSession(request, body, { id: admitted.session, remember: admitted.remember, stage: admitted.stage })
}

export const handleStoreGoogle = async (request: Request, deps: StoreGoogleDeps): Promise<Response> => {
  const url = new URL(request.url)
  if (url.pathname === localGooglePath) return deps.local && request.method === 'GET' ? localGooglePage(url) : new Response('Not found', { status: 404 })
  const facts = factsOf(request)
  // Per address, per host, as every sign-in route (auth.ts).
  if (facts.ip === null || !(await deps.allowAttempt(`store:${deps.host}:ip:${facts.ip}`))) return url.pathname === paths.token || url.pathname === paths.resume ? refuse({ code: 'RATE_LIMITED' }) : redirect('/sign-in?outcome=busy')
  if (url.pathname === paths.token) return exchangeToken(request, deps, facts)
  if (url.pathname === paths.resume) return request.method === 'POST' && originAllowed(request, deps.host) ? resumeSignup(deps, readCookie(request.headers.get('cookie'), signupCookieName)) : new Response('Method not allowed', { status: 405 })
  if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
  if (url.pathname === paths.start) return start(url, deps)
  return callback(request, url, deps, facts)
}
