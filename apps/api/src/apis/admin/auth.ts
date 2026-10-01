import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { factsOf, reauthenticated, signedIn, signedOut, signInRefused } from '#auth/activity'
import { clearCookie, originAllowed, readCookie, setCookie } from '#auth/cookie'
import type { IdentityProvider } from '#auth/oidc'
import type { SignInRefusal } from '#auth/oidc'
import { identityClaims, refusalForProviderError, SignInFailed, signInStateFor } from '#auth/oidc'
import { createSession, endSession, markReauthenticated } from '#auth/session'
import { staffForClaims } from '#auth/staff'
import { withSystemScope } from '#db/scoped/index'

export interface AuthDeps {
  sql: postgres.Sql
  provider: IdentityProvider
  activity: ActivityLog
  adminHost: string
  now: () => Date
  /** Returns false when the caller has made too many attempts (ARCHITECTURE.md §7). */
  allowAttempt: (request: Request) => Promise<boolean>
}

const paths = {
  signIn: '/api/auth/sign-in',
  reauth: '/api/auth/reauth',
  callback: '/api/auth/callback',
  signOut: '/api/auth/sign-out',
}

/** The SPA route #17 built, not an API path. */
const signInPath = '/sign-in'

export const isAuthPath = (pathname: string): boolean => Object.values(paths).includes(pathname)

const redirectUri = (adminHost: string) => `https://${adminHost}${paths.callback}`

/** One `refused` for every account question, so this cannot enumerate staff (ACCESS.md §4). */
const refusedResponse = (refusal: SignInRefusal) =>
  new Response(null, {
    status: 302,
    headers: [
      ['location', `${signInPath}?outcome=${signInStateFor(refusal)}`],
      ['set-cookie', clearHandshake()],
    ],
  })

const handshakeCookie = '__Host-df_admin_oidc'

type Purpose = 'signin' | 'reauth'

// The purpose is in the cookie, not the query: a callback must not be able to turn a sign-in
// handshake into a re-authentication, or the reverse.
const readHandshake = (header: string | null): { state: string; nonce: string; purpose: Purpose } | null => {
  const raw = (header?.match(new RegExp(`${handshakeCookie}=([^;]+)`)) ?? [])[1]
  const [state, nonce, purpose] = raw?.split('.') ?? []
  if (!state || !nonce) return null
  return purpose === 'reauth' || purpose === 'signin' ? { state, nonce, purpose } : null
}

const clearHandshake = () => `${handshakeCookie}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

export const handleAuth = async (request: Request, deps: AuthDeps): Promise<Response> => {
  const url = new URL(request.url)
  if (!originAllowed(request, deps.adminHost)) return new Response('Bad origin', { status: 403 })

  if (url.pathname === paths.signIn || url.pathname === paths.reauth) {
    const purpose: Purpose = url.pathname === paths.reauth ? 'reauth' : 'signin'
    const state = crypto.randomUUID()
    const nonce = crypto.randomUUID()
    return new Response(null, {
      status: 302,
      headers: {
        location: deps.provider.authorizeUrl({
          redirectUri: redirectUri(deps.adminHost),
          state,
          nonce,
          ...(purpose === 'reauth' ? { prompt: 'login' as const } : {}),
        }),
        'set-cookie': `${handshakeCookie}=${state}.${nonce}.${purpose}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
      },
    })
  }

  if (url.pathname === paths.callback) {
    const facts = factsOf(request)
    if (!(await deps.allowAttempt(request))) return new Response('Too many attempts', { status: 429 })

    // The answer must not depend on the database: a caller able to cause an error there
    // could otherwise tell which refusals reach it (CONSOLE-DESIGN A1).
    const refuse = async (refusal: SignInRefusal) => {
      try {
        await withSystemScope(deps.sql, (tx) => deps.activity.record(tx, signInRefused(facts, refusal)))
      } catch {
        console.error(JSON.stringify({ code: 'activity_record_failed', action: 'staff.sign_in_refused', refusal }))
      }
      return refusedResponse(refusal)
    }

    // Checked before anything else in the query is believed; an error response carries
    // `state` too (RFC 6749 §4.1.2.1).
    const handshake = readHandshake(request.headers.get('cookie'))
    if (!handshake) return refuse('missing_handshake')
    if (handshake.state !== url.searchParams.get('state')) return refuse('state_mismatch')

    // Microsoft sends the person back here with an error and no code when they cancel, or
    // when Conditional Access stops them; that is the screen's cause, not a missing code.
    const providerError = url.searchParams.get('error')
    if (providerError) {
      return refuse(refusalForProviderError(providerError, url.searchParams.get('error_description') ?? ''))
    }

    const code = url.searchParams.get('code')
    if (!code) return refuse('missing_code')

    try {
      // safeParse: a ZodError would escape the catch below and answer 500, not the 401.
      const parsed = identityClaims.safeParse(
        await deps.provider.exchange({ code, redirectUri: redirectUri(deps.adminHost), nonce: handshake.nonce }),
      )
      if (!parsed.success) throw new SignInFailed('bad_claims')
      const claims = parsed.data
      if (handshake.purpose === 'reauth') {
        const current = readCookie(request.headers.get('cookie'))
        if (!current) throw new SignInFailed('no_session_to_reauth')
        const stamped = await withSystemScope(deps.sql, async (tx) => {
          const staff = await staffForClaims(tx, claims)
          // Whoever came back from Microsoft must be the person whose session this is, or a
          // second staff member could refresh someone else's credential.
          const ok = await markReauthenticated(tx, current, staff.id, deps.now())
          if (ok) await deps.activity.record(tx, reauthenticated(staff, facts))
          return ok
        })
        // Not `unknown_subject`: the person is known, the session they offered is not theirs
        // or has expired, and the log should say which.
        if (!stamped) throw new SignInFailed('reauth_session_mismatch')
        return new Response(null, { status: 302, headers: [['location', '/'], ['set-cookie', clearHandshake()]] })
      }

      const id = await withSystemScope(deps.sql, async (tx) => {
        const staff = await staffForClaims(tx, claims)
        const sessionId = await createSession(tx, staff.id, deps.now())
        await deps.activity.record(tx, signedIn(staff, facts))
        return sessionId
      })
      return new Response(null, {
        status: 302,
        headers: [
          ['location', '/'],
          ['set-cookie', setCookie(id)],
          ['set-cookie', clearHandshake()],
        ],
      })
    } catch (error) {
      // Only a refusal answers 401. Anything else is an outage mid-sign-in, and filing a
      // false `sign_in_refused` for a staff member who was not refused would be worse.
      if (!(error instanceof SignInFailed)) throw error
      return refuse(error.refusal)
    }
  }

  // GET is exempt from the Origin check, so a GET sign-out would let any page force one.
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const id = readCookie(request.headers.get('cookie'))
  if (id) {
    await withSystemScope(deps.sql, async (tx) => {
      const actor = await endSession(tx, id)
      if (actor) await deps.activity.record(tx, signedOut(actor, factsOf(request)))
    })
  }
  return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearCookie() } })
}
