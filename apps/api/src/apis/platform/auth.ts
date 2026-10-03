import type postgres from 'postgres'
import type { ActivityLog } from '#auth/activity'
import { factsOf, partnerSignedOut } from '#auth/activity'
import { originAllowed, readCookie } from '#auth/cookie'
import { clearPartnerCookie, endPartnerSession, partnerCookieName } from '#auth/partnerSession'
import { withSystemScope } from '#db/scoped/index'
import { partnerOfUser } from '#db/scoped/partnerUsers'

export interface PlatformAuthDeps {
  sql: postgres.Sql
  activity: ActivityLog
  platformHost: string
}

// Sign-in, 2-factor, invitations and reset join these on #156 (FIRST-RELEASE §16).
const paths = { signOut: '/api/auth/sign-out' }

export const isPlatformAuthPath = (pathname: string): boolean => Object.values(paths).includes(pathname)

export const handlePlatformAuth = async (request: Request, deps: PlatformAuthDeps): Promise<Response> => {
  if (!originAllowed(request, deps.platformHost)) return new Response('Bad origin', { status: 403 })
  // GET is exempt from the Origin check, so a GET sign-out would let any page force one.
  if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const id = readCookie(request.headers.get('cookie'), partnerCookieName)
  if (id) {
    await withSystemScope(deps.sql, async (tx) => {
      const userId = await endPartnerSession(tx, id)
      const partnerId = userId ? await partnerOfUser(tx, userId) : null
      if (userId && partnerId) await deps.activity.record(tx, partnerSignedOut({ id: userId, partnerId }, factsOf(request)))
    })
  }
  return new Response(null, { status: 302, headers: { location: '/', 'set-cookie': clearPartnerCookie() } })
}
