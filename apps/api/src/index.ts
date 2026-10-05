import type postgres from 'postgres'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { handleAuth, isAuthPath } from '#apis/admin/auth'
import { createServer } from '#apis/graphql/server'
import { handleHealthCheck, isHealthPath } from '#apis/health'
import { handlePlatformAuth, isPlatformAuthPath } from '#apis/platform/auth'
import { brandUploadPath, handleBrandUpload } from '#apis/platform/uploads'
import { platformSchema, type PlatformContext } from '#apis/platform/schema'
import { shopSchema } from '#apis/shop/schema'
import { signedOutStoreContext } from '#apis/store/access'
import { storeSchema, type StoreContext } from '#apis/store/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import { resolvePartner } from '#auth/partnerCaller'
import { resolvePortalPartner, resolveStoreStanding } from '#auth/storeCaller'
import { platformContextFor, signedOutContext } from '#apis/platform/context'
import { partnerCookieName } from '#auth/partnerSession'
import { staffPortalCookieName } from '#auth/staffPortal'
import { passwordResetRequestKind } from '#auth/partnerTokens'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStaff } from '#auth/caller'
import { originAllowed, readCookie } from '#auth/cookie'
import type { IdentityProvider } from '#auth/oidc'
import { SignInFailed } from '#auth/oidc'
import { parseConfig, type Config } from '#core/config'
import { failureCode, logEvent } from '#core/log'
import { getClient } from '#db/client'
import { dohLookup } from '#integrations/dns/doh'
import { entraProvider } from '#integrations/entra/provider'
import { stripeClient, type StripeApi } from '#integrations/stripe/index'
import { handleStripeHook, stripeHookPath } from '#hooks/stripe'
import { handleSesHook, sesHookPath } from '#hooks/ses'
import { sesClient, snsVerifier, type SesApi, type SnsVerifier } from '#integrations/ses/index'
import { emailDeliverer } from '#jobs/queues/deliverers/email'
import { customDomainRecheckDeliverer } from '#jobs/queues/deliverers/customDomainRecheck'
import { activityExportDeliverer } from '#jobs/queues/deliverers/activityExport'
import { reportExportDeliverer } from '#jobs/queues/deliverers/reportExport'
import { storesExportDeliverer } from '#jobs/queues/deliverers/storesExport'
import { staffActivityExportDeliverer } from '#jobs/queues/deliverers/staffActivityExport'
import { domainRecheckDeliverer } from '#jobs/queues/deliverers/domainRecheck'
import { partnerPasswordResetDeliverer } from '#jobs/queues/deliverers/partnerPasswordReset'
import { deleteExpiredExports, failDeadExports } from '#db/scoped/exportJobs'
import { withSystemScope } from '#db/scoped/index'
import { queueDueDomainChecks } from '#jobs/queues/domainSchedule'
import { defaultRelayOptions, relayDue, type Deliverers } from '#jobs/queues/outbox-relay'
import { activityLog } from '#saas/activity/index'
import { createStaffActivityService } from '#saas/staffActivity/index'
import { createDashboardService } from '#saas/dashboard/index'
import { createPartnersService } from '#saas/partners/index'
import { exportLifetimeMs } from '#saas/partnerActivity/index'
import { createStoresService } from '#saas/stores/index'
import { createProvisioningService } from '#saas/provisioning/index'
import { createStaffSessionsService } from '#saas/staffSessions/index'
import { createCustomersService } from '#saas/customers/index'
import { expireUnsentSms } from '#saas/sms/index'
import { createStaffMembersService } from '#saas/staffMembers/index'
import { resolveArea, type Area } from './router'

const servers = {
  admin: createServer<AdminContext>(adminSchema, '/api'),
  platform: createServer<PlatformContext>(platformSchema, '/api'),
  store: createServer<StoreContext>(storeSchema, '/api'),
  shop: createServer(shopSchema, '/shop-api'),
}

interface Env extends Record<string, unknown> {
  HEALTH_RATE_LIMITER: RateLimit
  CF_VERSION_METADATA: { id: string; tag: string }
  // Optional because an environment whose wrangler.jsonc lacks the entry really has none;
  // typing it as present would make the check below look like dead code.
  SIGN_IN_RATE_LIMITER?: RateLimit | undefined
  // The partner console's staff-session routes, polled by every tab (ACCESS.md §8.3).
  STAFF_SESSION_RATE_LIMITER?: RateLimit | undefined
  // Bound only where the bucket exists (THIRD-PARTY-ACCESS.md §2.1); uploads answer NOT_CONNECTED otherwise.
  ASSETS?: R2Bucket | undefined
}

// Built once per isolate from configuration, like Stripe's client below.
let sesBuilt: { key: string; api: SesApi } | undefined

// THIRD-PARTY-ACCESS.md §2.4: all five values or no email; without them it waits in the outbox.
const sesFor = (config: Config): { api: SesApi; senderDomain: string; suppressionKey: string } | null => {
  const { SES_REGION: region, SES_ACCESS_KEY_ID: accessKeyId, SES_SECRET_ACCESS_KEY: secretAccessKey, SES_SENDER_DOMAIN: senderDomain, EMAIL_SUPPRESSION_KEY: suppressionKey } = config
  if (!region || !accessKeyId || !secretAccessKey || !senderDomain || !suppressionKey) return null
  const key = `${region}:${accessKeyId}:${secretAccessKey}`
  if (sesBuilt?.key !== key) sesBuilt = { key, api: sesClient({ region, accessKeyId, secretAccessKey }) }
  return { api: sesBuilt.api, senderDomain, suppressionKey }
}

// The side effects the relay can deliver. `email` waits, unclaimed, until SES is configured (outbox-relay.ts).
const deliverersFor = (sql: postgres.Sql, config: Config): Deliverers => {
  const lookup = dohLookup()
  const ses = sesFor(config)
  return {
    ...(ses ? { email: emailDeliverer(sql, ses.api, { hosts: { adminHost: config.ADMIN_HOST, platformHost: config.PLATFORM_HOST }, senderDomain: ses.senderDomain, suppressionKey: ses.suppressionKey }) } : {}),
    'domain.recheck': domainRecheckDeliverer(sql, lookup),
    'custom_domain.recheck': customDomainRecheckDeliverer(sql, lookup),
    'export.activity': activityExportDeliverer(sql),
    'export.report': reportExportDeliverer(sql),
    'export.stores': storesExportDeliverer(sql),
    'export.staff_activity': staffActivityExportDeliverer(sql),
    [passwordResetRequestKind]: partnerPasswordResetDeliverer(sql),
  }
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
    return servers.admin.fetch(request, { staff: null, isAssigned: async () => false, staffActivity: null, partners: null, stores: null, staffMembers: null, customers: null, staffSessions: null, provisioning: null, dashboard: null })
  }
  return withConnection(hyperdrive, ctx, async (sql) => {
    const caller = await resolveStaff(sql, request, new Date())
    const assigned = (staffId: string, target: Parameters<typeof isAssigned>[2]) => isAssigned(sql, staffId, target)
    return servers.admin.fetch(request, {
      staff: caller?.staff ?? null,
      isAssigned: assigned,
      staffActivity: caller ? createStaffActivityService({ sql, staff: caller.staff, facts: factsOf(request), activity: activityLog, now: () => new Date() }) : null,
      partners: caller
        ? createPartnersService({ sql, staff: caller.staff, reauthFresh: caller.reauthFresh, facts: factsOf(request), activity: activityLog, isAssigned: assigned, platformHost: config.PLATFORM_HOST, now: () => new Date() })
        : null,
      stores: caller ? createStoresService({ sql, staff: caller.staff, facts: factsOf(request), activity: activityLog, isAssigned: assigned, now: () => new Date() }) : null,
      provisioning: caller ? createProvisioningService({ sql, staff: caller.staff, now: () => new Date() }) : null,
      staffSessions: caller
        ? createStaffSessionsService({ sql, staff: caller.staff, facts: factsOf(request), activity: activityLog, reauthFresh: caller.reauthFresh, platformHost: config.PLATFORM_HOST, now: () => new Date() })
        : null,
      customers: caller ? createCustomersService({ sql, staff: caller.staff, facts: factsOf(request), activity: activityLog, now: () => new Date() }) : null,
      staffMembers: caller ? createStaffMembersService({ sql, staff: caller.staff, facts: factsOf(request), activity: activityLog, now: () => new Date() }) : null,
      dashboard: caller ? createDashboardService({ sql, staff: caller.staff, now: () => new Date() }) : null,
    })
  })
}

// Built once per isolate from configuration, like the identity provider.
let stripeBuilt: { key: string; api: StripeApi } | undefined

const stripeFor = (config: Config): StripeApi | null => {
  const key = config.STRIPE_SECRET_KEY
  if (!key) return null
  if (stripeBuilt?.key !== key) stripeBuilt = { key, api: stripeClient({ secretKey: key }) }
  return stripeBuilt.api
}

// Imported once per isolate, like the identity provider, and only from configuration.
let box: { key: string; secrets: Promise<SecretBox> } | undefined

const secretsFor = (config: Config): Promise<SecretBox> | null => {
  const key = config.CREDENTIALS_KEK
  if (!key) return null
  if (box?.key !== key) box = { key, secrets: secretBox(key) }
  return box.secrets
}

const handlePlatform = async (request: Request, url: URL, config: Config, env: Env, ctx: ExecutionContext): Promise<Response> => {
  // Every mutation on this cookie, as on the admin host (ACCESS.md §4).
  if (!originAllowed(request, config.PLATFORM_HOST)) return new Response('Bad origin', { status: 403 })

  const hyperdrive = config.HYPERDRIVE
  if (url.pathname === brandUploadPath) {
    if (!hyperdrive) return new Response(null, { status: 503 })
    const assets = env.ASSETS ?? null
    return withConnection(hyperdrive, ctx, (sql) => handleBrandUpload(request, { sql, activity: activityLog, store: assets, now: () => new Date() }))
  }
  if (isPlatformAuthPath(url.pathname)) {
    if (!hyperdrive) return new Response(null, { status: 503 })
    const limiter = env.SIGN_IN_RATE_LIMITER
    if (!limiter) return misconfigured('SIGN_IN_RATE_LIMITER')
    const staffLimiter = env.STAFF_SESSION_RATE_LIMITER
    if (!staffLimiter) return misconfigured('STAFF_SESSION_RATE_LIMITER')
    const secrets = await secretsFor(config)
    return withConnection(hyperdrive, ctx, (sql) =>
      handlePlatformAuth(request, {
        sql,
        activity: activityLog,
        platformHost: config.PLATFORM_HOST,
        secrets,
        now: () => new Date(),
        allowAttempt: async (key) => (await limiter.limit({ key })).success,
        allowStaffRead: async (key) => (await staffLimiter.limit({ key })).success,
      }),
    )
  }

  const cookies = request.headers.get('cookie')
  if (!hyperdrive || (readCookie(cookies, partnerCookieName) === null && readCookie(cookies, staffPortalCookieName) === null)) {
    return servers.platform.fetch(request, signedOutContext)
  }
  const secrets = await secretsFor(config)
  return withConnection(hyperdrive, ctx, async (sql) => {
    const caller = await resolvePartner(sql, request, new Date(), activityLog)
    return servers.platform.fetch(request, platformContextFor(caller, { sql, facts: factsOf(request), activity: activityLog, secrets, stripe: stripeFor(config), now: () => new Date() }))
  })
}

// A partner's portal host (docs/ARCHITECTURE.md §2): a host no partner holds answers 404, and the
// caller is the session's person acting in the store the request names (ACCESS.md §4).
const handleStore = async (request: Request, url: URL, config: Config, ctx: ExecutionContext): Promise<Response> => {
  if (!originAllowed(request, url.host)) return new Response('Bad origin', { status: 403 })
  const hyperdrive = config.HYPERDRIVE
  if (!hyperdrive) return servers.store.fetch(request, signedOutStoreContext(factsOf(request)))
  return withConnection(hyperdrive, ctx, async (sql) => {
    const partnerId = await resolvePortalPartner(sql, url.hostname)
    if (!partnerId) return notFound()
    const facts = factsOf(request)
    const standing = await resolveStoreStanding(sql, request, partnerId, new Date(), activityLog, facts)
    return servers.store.fetch(request, { standing, sql, facts, now: () => new Date() })
  })
}

// SNS signs with few certificates; one verifier per isolate fetches each once.
let snsBuilt: SnsVerifier | undefined

// hooks.dripfunnel.com: Stripe's billing events (SAAS §7.2) and SES's bounces and complaints
// (THIRD-PARTY-ACCESS.md §2.4). A route whose values aren't set doesn't exist.
const handleHooks = async (request: Request, url: URL, config: Config, ctx: ExecutionContext): Promise<Response> => {
  if (url.pathname === sesHookPath) {
    const topicArn = config.SES_EVENTS_TOPIC_ARN
    const suppressionKey = config.EMAIL_SUPPRESSION_KEY
    if (!topicArn || !suppressionKey) return notFound()
    if (!config.HYPERDRIVE) return new Response(null, { status: 503 })
    snsBuilt ??= snsVerifier()
    const verifier = snsBuilt
    return withConnection(config.HYPERDRIVE, ctx, (sql) => handleSesHook(request, { sql, verifier, topicArn, suppressionKey, now: () => new Date() }))
  }
  const stripe = stripeFor(config)
  const signingSecret = config.STRIPE_WEBHOOK_SECRET
  if (url.pathname !== stripeHookPath || !stripe || !signingSecret) return notFound()
  const hyperdrive = config.HYPERDRIVE
  // Stripe delivers again after a 503, so nothing is lost while the database is away.
  if (!hyperdrive) return new Response(null, { status: 503 })
  return withConnection(hyperdrive, ctx, (sql) => handleStripeHook(request, { sql, stripe, signingSecret, now: () => new Date() }))
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
  if (!area) return { response: notFound(), area: null }
  if (area === 'hooks') return { response: await handleHooks(request, url, config, ctx), area }
  if (isHealthPath(area, url.pathname)) {
    return { response: await handleHealthCheck(request, area, config, ctx, env.HEALTH_RATE_LIMITER, env.CF_VERSION_METADATA.id), area }
  }
  if (area === 'admin') return { response: await handleAdmin(request, url, config, env, ctx), area }
  if (area === 'platform') return { response: await handlePlatform(request, url, config, env, ctx), area }
  if (area === 'store') return { response: await handleStore(request, url, config, ctx), area }
  return { response: await servers[area].fetch(request), area }
}

// The relay needs a database and a configuration; without either there is nothing to deliver.
const relayWith = async (env: Env, work: (sql: postgres.Sql, config: Config) => Promise<void>): Promise<void> => {
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
    await work(sql, config)
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

  // Every minute from wrangler.jsonc's cron trigger: due domain checks (SAAS §8), then the outbox
  // sweep (api/README.md §5) that delivers them.
  async scheduled(_controller, env) {
    await relayWith(env, async (sql, config) => {
      // A scheduling failure is logged and never holds up the outbox sweep below.
      const due = await queueDueDomainChecks(sql, new Date()).catch((error: unknown) => {
        logEvent({ event: 'domain_checks_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
        return 0
      })
      if (due > 0) logEvent({ event: 'domain_checks_queued', api: 'system', code: 'scheduled', count: due })
      const purged = await withSystemScope(sql, async (tx) => {
        const at = new Date()
        await failDeadExports(tx, at, new Date(at.getTime() + exportLifetimeMs))
        return deleteExpiredExports(tx, at)
      }).catch((error: unknown) => {
        logEvent({ event: 'exports_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
        return 0
      })
      if (purged > 0) logEvent({ event: 'exports_purged', api: 'system', code: 'expired', count: purged })
      const expired = await withSystemScope(sql, (tx) => expireUnsentSms(tx, new Date(), defaultRelayOptions.leaseMs)).catch((error: unknown) => {
        logEvent({ event: 'sms_expiry_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
        return 0
      })
      if (expired > 0) logEvent({ event: 'sms_expired', api: 'system', code: 'expired', count: expired })
      const counts = await relayDue(sql, deliverersFor(sql, config))
      for (const [outcome, count] of Object.entries(counts)) {
        if (count > 0) logEvent({ event: 'outbox_relay', api: 'system', code: outcome, count })
      }
    })
  },
} satisfies ExportedHandler<Env>
