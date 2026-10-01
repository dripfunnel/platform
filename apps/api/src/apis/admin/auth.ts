import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { factsOf, signedIn, signedOut, signInRefused } from '#auth/activity'
import { clearCookie, originAllowed, readCookie, setCookie } from '#auth/cookie'
import type { IdentityProvider } from '#auth/oidc'
import type { SignInRefusal } from '#auth/oidc'
import { identityClaims, SignInFailed } from '#auth/oidc'
import { createSession, endSession } from '#auth/session'
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

const paths = { signIn: '/api/auth/sign-in', callback: '/api/auth/callback', signOut: '/api/auth/sign-out' }

export const isAuthPath = (pathname: string): boolean => Object.values(paths).includes(pathname)

const redirectUri = (adminHost: string) => `https://${adminHost}${paths.callback}`

// One refusal for every cause, headers included, so the response cannot be used to tell them
// apart (CONSOLE-DESIGN A1).
const refusedResponse = () =>
  new Response('Sign-in failed', { status: 401, headers: { 'set-cookie': clearHandshake() } })

const handshakeCookie = '__Host-df_admin_oidc'

const readHandshake = (header: string | null): { state: string; nonce: string } | null => {
  const raw = (header?.match(new RegExp(`${handshakeCookie}=([^;]+)`)) ?? [])[1]
  const [state, nonce] = raw?.split('.') ?? []
  return state && nonce ? { state, nonce } : null
}

const clearHandshake = () => `${handshakeCookie}=; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=0`

export const handleAuth = async (request: Request, deps: AuthDeps): Promise<Response> => {
  const url = new URL(request.url)
  if (!originAllowed(request, deps.adminHost)) return new Response('Bad origin', { status: 403 })

  if (url.pathname === paths.signIn) {
    const state = crypto.randomUUID()
    const nonce = crypto.randomUUID()
    return new Response(null, {
      status: 302,
      headers: {
        location: deps.provider.authorizeUrl({ redirectUri: redirectUri(deps.adminHost), state, nonce }),
        'set-cookie': `${handshakeCookie}=${state}.${nonce}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=600`,
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
      return refusedResponse()
    }

    const code = url.searchParams.get('code')
    const handshake = readHandshake(request.headers.get('cookie'))
    // `state` is the callback's CSRF protection: without comparing it to what we sent, any
    // page could drive this route with a code of its own choosing.
    if (!code) return refuse('missing_code')
    if (!handshake) return refuse('missing_handshake')
    if (handshake.state !== url.searchParams.get('state')) return refuse('state_mismatch')

    try {
      // safeParse: a ZodError would escape the catch below and answer 500, not the 401.
      const parsed = identityClaims.safeParse(
        await deps.provider.exchange({ code, redirectUri: redirectUri(deps.adminHost), nonce: handshake.nonce }),
      )
      if (!parsed.success) throw new SignInFailed('bad_claims')
      const claims = parsed.data
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
