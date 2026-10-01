import type postgres from 'postgres'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { handleAuth, isAuthPath } from '#apis/admin/auth'
import { createServer } from '#apis/graphql/server'
import { handleHealthCheck, isHealthPath } from '#apis/health'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'
import { interimActivityLog } from '#auth/activity'
import { resolveStaff } from '#auth/caller'
import { originAllowed, readCookie } from '#auth/cookie'
import type { IdentityProvider } from '#auth/oidc'
import { SignInFailed } from '#auth/oidc'
import { parseConfig, type Config } from '#core/config'
import { getClient } from '#db/client'
import { resolveArea } from './router'

const servers = {
  admin: createServer<AdminContext>(adminSchema, '/api'),
  platform: createServer(platformSchema, '/api'),
  store: createServer(storeSchema, '/api'),
  shop: createServer(shopSchema, '/shop-api'),
}

interface Env extends Record<string, unknown> {
  HEALTH_RATE_LIMITER: RateLimit
  CF_VERSION_METADATA: { id: string; tag: string }
  // Optional because an environment whose wrangler.jsonc lacks the entry really has none;
  // typing it as present would make the check below look like dead code.
  SIGN_IN_RATE_LIMITER?: RateLimit | undefined
}

const notFound = () => new Response('Not found', { status: 404 })

// An operator error, not a sign-in outcome: 500 like any other bad configuration, and
// logged, rather than an unhandled throw on the first request to reach it.
const misconfigured = (binding: string) => {
  console.error(JSON.stringify({ code: 'config_invalid', binding }))
  return new Response(null, { status: 500 })
}

// #89 replaces this with the real Entra ID exchange; until then the Worker has no provider
// and every sign-in attempt is refused.
const noProvider: IdentityProvider = {
  authorizeUrl: () => '/sign-in?state=refused',
  exchange: async () => {
    throw new SignInFailed('provider_unconfigured')
  },
}

const withConnection = async (
  hyperdrive: NonNullable<Config['HYPERDRIVE']>,
  ctx: ExecutionContext,
  work: (sql: postgres.Sql) => Promise<Response>,
): Promise<Response> => {
  const sql = getClient(hyperdrive)
  try {
    return await work(sql)
  } finally {
    // After the response, not before it: the body may not be read yet when this runs.
    ctx.waitUntil(sql.end({ timeout: 5 }))
  }
}

const handleAdmin = async (
  request: Request,
  url: URL,
  config: Config,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  // Every mutation on this cookie, not only sign-in (ACCESS.md §4). #14 and #39 add
  // mutations behind the same session, and SameSite=Lax alone does not hold.
  if (!originAllowed(request, config.ADMIN_HOST)) return new Response('Bad origin', { status: 403 })

  const hyperdrive = config.HYPERDRIVE
  if (isAuthPath(url.pathname)) {
    if (!hyperdrive) return new Response(null, { status: 503 })
    const limiter = env.SIGN_IN_RATE_LIMITER
    if (!limiter) return misconfigured('SIGN_IN_RATE_LIMITER')
    return withConnection(hyperdrive, ctx, (sql) =>
      handleAuth(request, {
        sql,
        provider: noProvider,
        activity: interimActivityLog,
        adminHost: config.ADMIN_HOST,
        now: () => new Date(),
        // Keyed per address, never pooled: a shared fallback key lets a few attempts 429
        // every staff member behind it. Cloudflare sets this header on all real traffic.
        allowAttempt: async (req) => {
          const ip = req.headers.get('cf-connecting-ip')
          if (!ip) return false
          return (await limiter.limit({ key: ip })).success
        },
      }),
    )
  }

  // No cookie, or no database to check one against: the caller is nobody, not an error —
  // `me` decides whether the console offers sign-in (apis/admin/schema.ts).
  if (!hyperdrive || readCookie(request.headers.get('cookie')) === null) {
    return servers.admin.fetch(request, { staff: null })
  }
  return withConnection(hyperdrive, ctx, async (sql) =>
    servers.admin.fetch(request, { staff: await resolveStaff(sql, request, new Date()) }),
  )
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url)
    let config
    try {
      config = parseConfig(env)
    } catch {
      console.error(JSON.stringify({ code: 'config_invalid' }))
      return new Response(null, { status: 500 })
    }
    const area = resolveArea(url, config)
    if (!area || area === 'hooks') return notFound()
    if (isHealthPath(area, url.pathname)) return handleHealthCheck(request, area, config, ctx, env.HEALTH_RATE_LIMITER, env.CF_VERSION_METADATA.id)
    if (area === 'admin') return handleAdmin(request, url, config, env, ctx)
    return servers[area].fetch(request)
  },
} satisfies ExportedHandler<Env>
