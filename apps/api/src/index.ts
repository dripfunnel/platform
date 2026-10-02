import type postgres from 'postgres'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { handleAuth, isAuthPath } from '#apis/admin/auth'
import { createServer } from '#apis/graphql/server'
import { handleHealthCheck, isHealthPath } from '#apis/health'
import { platformSchema } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { storeSchema } from '#apis/store/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import { resolveStaff } from '#auth/caller'
import { partnerScopedRoles } from '#auth/permissions'
import { originAllowed, readCookie } from '#auth/cookie'
import type { IdentityProvider } from '#auth/oidc'
import { SignInFailed } from '#auth/oidc'
import { parseConfig, type Config } from '#core/config'
import { failureCode, logEvent } from '#core/log'
import { getClient } from '#db/client'
import { dohLookup } from '#integrations/dns/doh'
import { entraProvider } from '#integrations/entra/provider'
import { customDomainRecheckDeliverer } from '#jobs/queues/deliverers/customDomainRecheck'
import { domainRecheckDeliverer } from '#jobs/queues/deliverers/domainRecheck'
import { relayDue, type Deliverers } from '#jobs/queues/outbox-relay'
import { activityLog, listActivity } from '#saas/activity/index'
import { createDashboardService } from '#saas/dashboard/index'
import { createPartnersService } from '#saas/partners/index'
import { createStoresService } from '#saas/stores/index'
import { resolveArea, type Area } from './router'

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

// The side effects the relay can deliver. `email` has no deliverer until SES is wired
// (THIRD-PARTY-ACCESS.md §2.4), so a queued invitation waits, unclaimed (outbox-relay.ts).
const deliverersFor = (sql: postgres.Sql): Deliverers => {
  const lookup = dohLookup()
  return { 'domain.recheck': domainRecheckDeliverer(sql, lookup), 'custom_domain.recheck': customDomainRecheckDeliverer(sql, lookup) }
}

const notConnected = async () => {
  throw new Error('no database for this request')
}

const notFound = () => new Response('Not found', { status: 404 })

// An operator error, not a sign-in outcome: 500 like any other bad configuration, and
// logged, rather than an unhandled throw on the first request to reach it.
const misconfigured = (binding: string) => {
  console.error(JSON.stringify({ code: 'config_invalid', binding }))
  return new Response(null, { status: 500 })
}

// Until the app registration exists (THIRD-PARTY-ACCESS.md §2.5) there is nothing to sign in
// against, so every attempt is refused rather than half-working.
const noProvider: IdentityProvider = {
  authorizeUrl: () => '/sign-in?outcome=unavailable',
  exchange: async () => {
    throw new SignInFailed('provider_unconfigured')
  },
}

// Built once per isolate, like `servers`: it holds Entra's key set, and one per request
// would refetch it on every sign-in. Derived from configuration, never from a request.
let built: { key: string; provider: IdentityProvider } | undefined

const providerFor = (config: Config): IdentityProvider => {
  const tenantId = config.ENTRA_TENANT_ID
  const clientId = config.ENTRA_CLIENT_ID
  const clientSecret = config.ENTRA_CLIENT_SECRET
  if (!tenantId || !clientId || !clientSecret) return noProvider

  const key = `${tenantId}.${clientId}`
  if (built?.key !== key) built = { key, provider: entraProvider({ tenantId, clientId, clientSecret }) }
  return built.provider
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
        provider: providerFor(config),
        activity: activityLog,
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
    return servers.admin.fetch(request, { staff: null, isAssigned: async () => false, activity: notConnected, partners: null, stores: null, dashboard: null })
  }
  return withConnection(hyperdrive, ctx, async (sql) => {
    const caller = await resolveStaff(sql, request, new Date())
    const assigned = (staffId: string, target: Parameters<typeof isAssigned>[2]) => isAssigned(sql, staffId, target)
    return servers.admin.fetch(request, {
      staff: caller?.staff ?? null,
      isAssigned: assigned,
      activity: caller
        ? (filter, page) =>
            listActivity(sql, { caller: { kind: 'staff', staffId: caller.staff.id } }, filter, page, {
              assignedTo: partnerScopedRoles.includes(caller.staff.role) ? caller.staff.id : undefined,
            })
        : notConnected,
      partners: caller
        ? createPartnersService({ sql, staff: caller.staff, reauthFresh: caller.reauthFresh, facts: factsOf(request), activity: activityLog, isAssigned: assigned, now: () => new Date() })
        : null,
      stores: caller ? createStoresService({ sql, staff: caller.staff, facts: factsOf(request), activity: activityLog, isAssigned: assigned, now: () => new Date() }) : null,
      dashboard: caller ? createDashboardService({ sql, staff: caller.staff, now: () => new Date() }) : null,
    })
  })
}

const route = async (request: Request, env: Env, ctx: ExecutionContext): Promise<{ response: Response; area: Area | null }> => {
  const url = new URL(request.url)
  let config
  try {
    config = parseConfig(env)
  } catch {
    console.error(JSON.stringify({ code: 'config_invalid' }))
    return { response: new Response(null, { status: 500 }), area: null }
  }
  const area = resolveArea(url, config)
  if (!area || area === 'hooks') return { response: notFound(), area: area ?? null }
  if (isHealthPath(area, url.pathname)) {
    return { response: await handleHealthCheck(request, area, config, ctx, env.HEALTH_RATE_LIMITER, env.CF_VERSION_METADATA.id), area }
  }
  if (area === 'admin') return { response: await handleAdmin(request, url, config, env, ctx), area }
  return { response: await servers[area].fetch(request), area }
}

// The relay needs a database and a configuration; without either there is nothing to deliver.
const relayWith = async (env: Env, work: (sql: postgres.Sql) => Promise<void>): Promise<void> => {
  let config
  try {
    config = parseConfig(env)
  } catch {
    logEvent({ event: 'relay_skipped', api: 'system', code: 'config_invalid' })
    return
  }
  if (!config.HYPERDRIVE) {
    logEvent({ event: 'relay_skipped', api: 'system', code: 'db_unconfigured' })
    return
  }
  const sql = getClient(config.HYPERDRIVE)
  try {
    await work(sql)
  } finally {
    await sql.end({ timeout: 5 })
  }
}

// An error nobody caught is a logged 500, never Cloudflare's own error page (LOGGING.md §9).
export const guarded = async (request: Request, work: () => Promise<{ response: Response; area: Area | null }>): Promise<{ response: Response; area: Area | null }> => {
  try {
    return await work()
  } catch (error) {
    logEvent({ event: 'request_failed', requestId: request.headers.get('cf-ray'), host: new URL(request.url).hostname, status: 500, code: failureCode(error) })
    return { response: new Response(null, { status: 500 }), area: null }
  }
}

export default {
  async fetch(request, env, ctx) {
    const started = Date.now()
    const { response, area } = await guarded(request, () => route(request, env, ctx))
    // LOGGING.md §9: ids, codes and timings only; the hostname carries no personal data.
    logEvent({
      event: 'request',
      requestId: request.headers.get('cf-ray'),
      api: area,
      host: new URL(request.url).hostname,
      status: response.status,
      durationMs: Date.now() - started,
    })
    return response
  },

  // The outbox sweep (api/README.md §5), every minute from wrangler.jsonc's cron trigger.
  async scheduled(_controller, env) {
    await relayWith(env, async (sql) => {
      const counts = await relayDue(sql, deliverersFor(sql))
      for (const [outcome, count] of Object.entries(counts)) {
        if (count > 0) logEvent({ event: 'outbox_relay', api: 'system', code: outcome, count })
      }
    })
  },
} satisfies ExportedHandler<Env>
