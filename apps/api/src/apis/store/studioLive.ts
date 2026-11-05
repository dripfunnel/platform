import { GraphQLError } from 'graphql'
import type { TenantContext } from '#core/tenancy'
import { storeHeader } from '#auth/storeCaller'
import { hashStudioSession, liveStudioSession, studioAccess } from '#saas/studio/index'
import { actingCaller, storePolicy, type StoreContext } from './access'
import { studioRead } from './studio'

// `/api/studio/live` on the portal host (storefront AI-STUDIO §4 "Live progress", #1237): the studio's one WebSocket,
// to the StudioSession of the store the session's TenantContext names. One-way: nothing is ever read from it.

export const studioLivePath = '/api/studio/live'
export const isStudioLivePath = (pathname: string): boolean => pathname === studioLivePath

/** A browser's socket can't set headers, so the acting store rides in `?store=` and is checked like `X-Store` (ACCESS §4). */
export const studioLiveRequest = (request: Request): Request => {
  const asked = new URL(request.url).searchParams.get('store')
  if (!asked) return request
  const headers = new Headers(request.headers)
  headers.set(storeHeader, asked)
  return new Request(request.url, { method: request.method, headers })
}

export interface StudioLiveDeps {
  /** Hands the upgrade to the context's store's StudioSession; null where no studio is bound. */
  open: ((context: TenantContext, input: { sessionHash: string; after: number }) => Promise<Response>) | null
}

const refused = (status: number) => new Response(null, { status, headers: { 'cache-control': 'no-store' } })

/** Only the portal's own page: a socket carries the cookie, so a GET's usual pass (auth/cookie.ts) isn't enough here. */
const fromPortal = (request: Request, host: string | undefined): boolean => {
  const origin = request.headers.get('origin')
  if (!origin || !host) return false
  try {
    return new URL(origin).host === host
  } catch {
    return false
  }
}

export const handleStudioLive = async (request: Request, ctx: StoreContext, deps: StudioLiveDeps): Promise<Response> => {
  if (request.method !== 'GET') return refused(405)
  if (request.headers.get('upgrade')?.toLowerCase() !== 'websocket') return refused(426)
  if (!fromPortal(request, ctx.host)) return refused(403)
  if (!ctx.sql || !deps.open) return refused(404)
  try {
    await storePolicy.authorize(studioRead, ctx, {}, 'query', { name: 'studioLive', root: true })
  } catch (error) {
    return refused(error instanceof GraphQLError && error.extensions['code'] === 'UNAUTHENTICATED' ? 401 : 403)
  }
  const caller = actingCaller(ctx)
  if (!studioAccess(caller.context, caller.role)) return refused(403)
  const url = new URL(request.url)
  const session = url.searchParams.get('session') ?? ''
  const after = Number(url.searchParams.get('after') ?? '0')
  if (!Number.isSafeInteger(after) || after < 0) return refused(400)
  // The studio session the frame uses, this person's: the socket closes with it (AI-STUDIO §8 "Short-lived").
  const live = await liveStudioSession(ctx.sql, caller.context.storeId, session, ctx.now())
  if (!live || live.userId !== caller.person.id) return refused(403)
  return deps.open(caller.context, { sessionHash: await hashStudioSession(session), after })
}
