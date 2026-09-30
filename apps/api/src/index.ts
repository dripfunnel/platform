import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { handleAuth, isAuthPath } from '#apis/admin/auth'
import { createServer } from '#apis/graphql/server'
import { handleHealthCheck, isHealthPath } from '#apis/health'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'
import { interimActivityLog } from '#auth/activity'
import { resolveStaff } from '#auth/caller'
import { readCookie } from '#auth/cookie'
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
  SIGN_IN_RATE_LIMITER: RateLimit
}

const notFound = () => new Response('Not found', { status: 404 })

// A missing binding is an operator error, not a sign-in outcome, so it answers 500 like any
// other bad configuration rather than the uniform refusal — deliberately, and logged, rather
// than as an unhandled throw on the first request to reach it.
const misconfigured = (binding: string) => {
  console.error(JSON.stringify({ code: 'config_invalid', binding }))
  return new Response(null, { status: 500 })
}

// #89 replaces this with the real Entra ID exchange; until then the Worker has no provider
// and every sign-in attempt is refused.
const noProvider: IdentityProvider = {
  authorizeUrl: () => '/sign-in?state=refused',
  exchange: async () => {
    throw new SignInFailed('no identity provider is configured')
  },
}

const handleAdmin = async (
  request: Request,
  url: URL,
  config: Config,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> => {
  const needsDatabase = isAuthPath(url.pathname) || readCookie(request.headers.get('cookie')) !== null
  // A signed-out caller asking for `me` needs no connection, and that is most of them.
  if (!needsDatabase) return servers.admin.fetch(request, { staff: null })
  if (!config.HYPERDRIVE) return new Response(null, { status: 503 })

  const sql = getClient(config.HYPERDRIVE)
  try {
    if (isAuthPath(url.pathname)) {
      if (!env.SIGN_IN_RATE_LIMITER) return misconfigured('SIGN_IN_RATE_LIMITER')
      return await handleAuth(request, {
        sql,
        provider: noProvider,
        activity: interimActivityLog,
        adminHost: config.ADMIN_HOST,
        now: () => new Date(),
        // Keyed per address, never pooled: a shared fallback key would let a handful of
        // attempts exhaust one bucket and 429 every staff member behind it. Cloudflare sets
        // this header on everything that reaches the edge, so its absence is not real
        // traffic and the attempt is refused rather than counted.
        allowAttempt: async (req) => {
          const ip = req.headers.get('cf-connecting-ip')
          if (!ip) return false
          return (await env.SIGN_IN_RATE_LIMITER.limit({ key: ip })).success
        },
      })
    }
    const staff = await resolveStaff(sql, request, new Date())
    return await servers.admin.fetch(request, { staff })
  } finally {
    // After the response, not before it: the body may not be read yet when this runs.
    ctx.waitUntil(sql.end({ timeout: 5 }))
  }
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
    if (isHealthPath(area, url.pathname)) return handleHealthCheck(request, area, config, ctx, env.HEALTH_RATE_LIMITER)
    if (area === 'admin') return handleAdmin(request, url, config, env, ctx)
    return servers[area].fetch(request)
  },
} satisfies ExportedHandler<Env>
