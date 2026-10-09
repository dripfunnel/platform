import type postgres from 'postgres'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { handleAuth, isAuthPath } from '#apis/admin/auth'
import { createServer } from '#apis/graphql/server'
import { handleHealthCheck, isHealthPath } from '#apis/health'
import { handlePlatformAuth, isPlatformAuthPath } from '#apis/platform/auth'
import { brandUploadPath, handleBrandUpload } from '#apis/platform/uploads'
import { platformSchema, type PlatformContext } from '#apis/platform/schema'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { handleShopAsset, isShopAssetPath } from '#apis/shop/assets'
import { shopCacheKey, throughShopCache, type ShopCache } from '#apis/shop/cache'
import { resolveShopper, shopSessionHeader } from '#auth/shopCaller'
import { signedOutStoreContext } from '#apis/store/access'
import { handleStoreAuth, isStoreAuthPath } from '#apis/store/auth'
import { handleAssets, isAssetsPath } from '#apis/store/assets'
import { brandFileOf, serveBrandFile } from '#apis/store/brandFiles'
import { storeSchema, type StoreContext } from '#apis/store/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import { resolvePartner } from '#auth/partnerCaller'
import { resolvePortalPartner, resolveStoreStanding } from '#auth/storeCaller'
import { storeOriginAllowed } from '#auth/storeCredential'
import { platformContextFor, signedOutContext } from '#apis/platform/context'
import { partnerCookieName } from '#auth/partnerSession'
import { staffPortalCookieName } from '#auth/staffPortal'
import { passwordResetRequestKind } from '#auth/partnerTokens'
import { userPasswordResetRequestKind } from '#auth/storeTokens'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { resolveStaff } from '#auth/caller'
import { originAllowed, readCookie } from '#auth/cookie'
import type { IdentityProvider } from '#auth/oidc'
import { SignInFailed } from '#auth/oidc'
import { parseConfig, type Config } from '#core/config'
import { failureCode, logEvent } from '#core/log'
import { getClient } from '#db/client'
import { dohLookup } from '#integrations/dns/doh'
import { localCloudflare, localCouriers, localDns, localEmail, localSms } from '#integrations/local/index'
import { smsDeliverer } from '#jobs/queues/deliverers/sms'
import { ecbRates } from '#integrations/ecb/rates'
import { entraProvider } from '#integrations/entra/provider'
import { stripeClient, type StripeApi } from '#integrations/stripe/index'
import { handleStripeHook, stripeHookPath } from '#hooks/stripe'
import { handleSesHook, sesHookPath } from '#hooks/ses'
import { handleShopifyCallback, shopifyCallbackPath } from '#hooks/shopify'
import { localShopify, shopifyApi, type ShopifyApi } from '#integrations/shopify/api'
import { deleteAbandonedConnections, deleteStalePendingConnections } from '#db/scoped/externalConnections'
import { sesClient, snsVerifier, type SesApi, type SnsVerifier } from '#integrations/ses/index'
import { collectionsRecomputeKind } from '#engine/modules/catalog/index'
import { collectionsRecomputeDeliverer } from '#jobs/queues/deliverers/collectionsRecompute'
import { ratesRefreshDeliverer, ratesRefreshKind } from '#jobs/queues/deliverers/ratesRefresh'
import { emailDeliverer } from '#jobs/queues/deliverers/email'
import { customDomainRecheckDeliverer } from '#jobs/queues/deliverers/customDomainRecheck'
import { activityExportDeliverer } from '#jobs/queues/deliverers/activityExport'
import { reportExportDeliverer } from '#jobs/queues/deliverers/reportExport'
import { storesExportDeliverer } from '#jobs/queues/deliverers/storesExport'
import { catalogExportDeliverer } from '#jobs/queues/deliverers/catalogExport'
import { orderNotifyDeliverer } from '#jobs/queues/deliverers/orderNotify'
import { orderUpdateKind } from '#db/scoped/orderUpdates'
import { catalogImportDeliverer, importPhotosDeliverer } from '#jobs/queues/deliverers/catalogImport'
import { deleteExpiredImports, failDeadImports } from '#db/scoped/catalogImports'
import { deleteExpiredCatalogExports, failDeadCatalogExports } from '#db/scoped/catalogExports'
import { staffActivityExportDeliverer } from '#jobs/queues/deliverers/staffActivityExport'
import { cloudflareClient } from '#integrations/cloudflare/api'
import { domainRemoveDeliverer } from '#jobs/queues/deliverers/domainRemove'
import { domainRecheckDeliverer } from '#jobs/queues/deliverers/domainRecheck'
import { partnerPasswordResetDeliverer } from '#jobs/queues/deliverers/partnerPasswordReset'
import { userPasswordResetDeliverer } from '#jobs/queues/deliverers/userPasswordReset'
import { deleteExpiredExports, failDeadExports } from '#db/scoped/exportJobs'
import { withSystemScope } from '#db/scoped/index'
import { deleteExpiredSignups } from '#db/scoped/signup'
import { queueDueDomainChecks } from '#jobs/queues/domainSchedule'
import { queueRatesRefresh } from '#jobs/queues/ratesSchedule'
import { releaseUnpaidOrders, type PaymentWiring } from '#engine/modules/checkout/index'
import type { PaymentMode } from '#core/payments'
import { stripeConnect } from '#integrations/stripe/connect'
import { stripePayments, type StripeKeys } from '#integrations/stripe/payments'
import { stripeTax } from '#integrations/stripe/tax'
import { handleStripeConnectCallback, stripeConnectCallbackPath } from '#hooks/stripeConnect'
import { handlePaymentHook, paymentHookOf } from '#hooks/payments'
import { keyedGateways } from '#integrations/payments/index'
import { deleteExpiredCarts } from '#db/scoped/cart'
import { purgeShopperIdentity } from '#db/scoped/shopper'
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
import { expireUnsentSms, smsKind, smsMessages, type PartnerSmsAccounts } from '#saas/sms/index'
import { createStaffMembersService } from '#saas/staffMembers/index'
import { resolveArea, type Area } from './router'

const servers = {
  admin: createServer<AdminContext>(adminSchema, '/api'),
  platform: createServer<PlatformContext>(platformSchema, '/api'),
  store: createServer<StoreContext>(storeSchema, '/api'),
  shop: createServer<ShopContext>(shopSchema, '/shop-api'),
}

interface Env extends Record<string, unknown> {
  HEALTH_RATE_LIMITER: RateLimit
  CF_VERSION_METADATA: { id: string; tag: string }
  // Optional because an environment whose wrangler.jsonc lacks the entry really has none;
  // typing it as present would make the check below look like dead code.
  SIGN_IN_RATE_LIMITER?: RateLimit | undefined
  // The partner console's staff-session routes, polled by every tab (ACCESS.md §8.3).
  STAFF_SESSION_RATE_LIMITER?: RateLimit | undefined
  // Every Shop API call, per storefront host and IP (FIRST-RELEASE §19).
  SHOP_RATE_LIMITER?: RateLimit | undefined
  // A guest's new carts, per store and IP (FIRST-RELEASE §19); unbound, nothing limits them.
  CART_RATE_LIMITER?: RateLimit | undefined
  // Bound only where the bucket exists (THIRD-PARTY-ACCESS.md §2.1); uploads answer NOT_CONNECTED otherwise.
  ASSETS?: R2Bucket | undefined
  IMAGES?: ImagesBinding | undefined
  // Wakes the outbox relay after a request (api/README.md §5); unbound, cron delivers.
  OUTBOX_WAKE?: Queue<OutboxWake> | undefined
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

// Connect Shopify's app (CATALOG K7): the real one where its secrets are set, the local stand-in where asked for.
let shopifyBuilt: { key: string; api: ShopifyApi } | undefined
const shopifyFor = (config: Config): { api: ShopifyApi; redirectUri: string } | null => {
  const redirectUri = `https://${config.HOOKS_HOST}${shopifyCallbackPath}`
  // Asked for, the stand-in wins (config refuses it anywhere but localhost), so a copied example never reaches Shopify.
  if (config.SHOPIFY_LOCAL === '1') return { api: localShopify(), redirectUri }
  const { SHOPIFY_CLIENT_ID: clientId, SHOPIFY_CLIENT_SECRET: clientSecret } = config
  if (clientId && clientSecret) {
    const key = `${clientId}:${clientSecret}`
    if (shopifyBuilt?.key !== key) shopifyBuilt = { key, api: shopifyApi({ clientId, clientSecret }) }
    return { api: shopifyBuilt.api, redirectUri }
  }
  return null
}

const shopConnectOf = (shopify: { api: ShopifyApi; redirectUri: string } | null) => (shopify ? { gateway: shopify.api, redirectUri: shopify.redirectUri } : null)

// Locally (SMS_LOCAL) every partner has an account on each provider, whose texts the stand-in prints (#275 sets the real ones).
const localSmsAccounts: PartnerSmsAccounts = {
  forPartner: async (_, __, provider) =>
    provider === 'msg91'
      ? { provider, authKey: 'local', templates: Object.fromEntries(smsMessages.map((m) => [m, 'local'])) }
      : { provider, accountSid: 'local', authToken: 'local', messagingServiceSid: 'local' },
}

// Asked for, the stand-in wins (EMAIL_LOCAL; config refuses it anywhere but localhost), as Shopify's does; else SES
// where its values are set; else email waits in the outbox.
const emailFor = (config: Config) => {
  if (config.EMAIL_LOCAL === '1' && config.EMAIL_SUPPRESSION_KEY) return { api: localEmail(), senderDomain: config.SES_SENDER_DOMAIN ?? 'mail.localhost', suppressionKey: config.EMAIL_SUPPRESSION_KEY }
  return sesFor(config)
}

// The side effects the relay can deliver. `email` waits, unclaimed, until SES (or locally its stand-in) is configured
// (outbox-relay.ts); `sms` likewise until partners' accounts exist (#275), or locally SMS_LOCAL.
const deliverersFor = (sql: postgres.Sql, config: Config, assets: R2Bucket | null, secrets: SecretBox | null): Deliverers => {
  const lookup = config.DNS_LOCAL === '1' ? localDns(sql, dohLookup()) : dohLookup()
  const ses = emailFor(config)
  const client = config.CF_CUSTOM_HOSTNAMES_TOKEN && config.CF_SAAS_ZONE_ID ? cloudflareClient({ token: config.CF_CUSTOM_HOSTNAMES_TOKEN, zoneId: config.CF_SAAS_ZONE_ID }) : null
  const cloudflare = client && config.DNS_LOCAL === '1' ? localCloudflare(client) : client
  return {
    [collectionsRecomputeKind]: collectionsRecomputeDeliverer(sql),
    ...(ses ? { email: emailDeliverer(sql, ses.api, { hosts: { adminHost: config.ADMIN_HOST, platformHost: config.PLATFORM_HOST }, senderDomain: ses.senderDomain, suppressionKey: ses.suppressionKey }) } : {}),
    ...(config.SMS_LOCAL === '1' ? { [smsKind]: smsDeliverer(sql, localSmsAccounts, { msg91: localSms, twilio: localSms }) } : {}),
    'domain.recheck': domainRecheckDeliverer(sql, lookup, () => new Date(), cloudflare),
    ...(cloudflare ? { 'domain.remove': domainRemoveDeliverer(sql, cloudflare) } : {}),
    'custom_domain.recheck': customDomainRecheckDeliverer(sql, lookup),
    'export.activity': activityExportDeliverer(sql),
    'export.report': reportExportDeliverer(sql),
    'export.stores': storesExportDeliverer(sql),
    'export.catalog': catalogExportDeliverer(sql),
    [orderUpdateKind]: orderNotifyDeliverer(sql),
    'import.catalog': catalogImportDeliverer(sql, shopConnectOf(shopifyFor(config)), secrets),
    'import.photos': importPhotosDeliverer(sql, assets, lookup),
    'export.staff_activity': staffActivityExportDeliverer(sql),
    [passwordResetRequestKind]: partnerPasswordResetDeliverer(sql),
    [userPasswordResetRequestKind]: userPasswordResetDeliverer(sql),
    [ratesRefreshKind]: ratesRefreshDeliverer(sql, ecbRates()),
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
        ? createPartnersService({ sql, staff: caller.staff, reauthFresh: caller.reauthFresh, facts: factsOf(request), activity: activityLog, isAssigned: assigned, platformHost: config.PLATFORM_HOST, localHosts: config.DNS_LOCAL === '1', now: () => new Date() })
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

// Merchants' card payments (SAPI 10): Stripe on the merchant's connected account in each mode whose platform keys are set,
// Connect Stripe where the app's id is, and Stripe Tax with the same keys. Built once per isolate.
let paymentsBuilt: { key: string; wiring: PaymentWiring } | undefined

const paymentsFor = (config: Config): PaymentWiring => {
  const main = config.STRIPE_SECRET_KEY
  const mainMode: PaymentMode = main?.includes('_live_') ? 'live' : 'test'
  const secretKeys: Partial<Record<PaymentMode, string>> = {}
  const keys: Partial<Record<PaymentMode, StripeKeys>> = {}
  if (main) secretKeys[mainMode] = main
  if (main && config.STRIPE_PUBLISHABLE_KEY) keys[mainMode] = { secretKey: main, publishableKey: config.STRIPE_PUBLISHABLE_KEY }
  if (config.STRIPE_TEST_SECRET_KEY && config.STRIPE_TEST_PUBLISHABLE_KEY && !keys.test) {
    secretKeys.test = config.STRIPE_TEST_SECRET_KEY
    keys.test = { secretKey: config.STRIPE_TEST_SECRET_KEY, publishableKey: config.STRIPE_TEST_PUBLISHABLE_KEY }
  }
  const key = [main, config.STRIPE_PUBLISHABLE_KEY, config.STRIPE_TEST_SECRET_KEY, config.STRIPE_CONNECT_CLIENT_ID, config.HOOKS_HOST].join('|')
  if (paymentsBuilt?.key === key) return paymentsBuilt.wiring
  const taxes = { live: secretKeys.live ? stripeTax({ secretKey: secretKeys.live }) : null, test: secretKeys.test ? stripeTax({ secretKey: secretKeys.test }) : null }
  const wiring: PaymentWiring = {
    gateways: { ...keyedGateways(), ...(keys.live || keys.test ? { stripe: stripePayments({ keys }) } : {}) },
    stripeConnect: config.STRIPE_CONNECT_CLIENT_ID && main ? stripeConnect({ clientId: config.STRIPE_CONNECT_CLIENT_ID, secretKey: main, redirectUri: `https://${config.HOOKS_HOST}${stripeConnectCallbackPath}` }) : null,
    stripeTax: (mode) => taxes[mode]?.calculate ?? null,
    webhookUrl: (provider, accountId) => `https://${config.HOOKS_HOST}/payments/${provider}/${accountId}`,
  }
  paymentsBuilt = { key, wiring }
  return wiring
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
    return servers.platform.fetch(request, platformContextFor(caller, { sql, facts: factsOf(request), activity: activityLog, secrets, stripe: stripeFor(config), edgeZone: config.EDGE_ZONE, localHosts: config.DNS_LOCAL === '1', now: () => new Date() }))
  })
}

// A partner's portal host (docs/ARCHITECTURE.md §2): a host no partner holds answers 404, and the
// caller is the session's person acting in the store the request names (ACCESS.md §4).
const handleStore = async (request: Request, url: URL, config: Config, env: Env, ctx: ExecutionContext): Promise<Response> => {
  if (!isStoreAuthPath(url.pathname) && !storeOriginAllowed(request, url.host)) return new Response('Bad origin', { status: 403 })
  const hyperdrive = config.HYPERDRIVE
  if (!hyperdrive) return servers.store.fetch(request, signedOutStoreContext(factsOf(request), activityLog))
  const secrets = await secretsFor(config)
  return withConnection(hyperdrive, ctx, async (sql) => {
    const partnerId = await resolvePortalPartner(sql, url.hostname)
    if (!partnerId) return notFound()
    const brandFile = brandFileOf(url.pathname)
    if (brandFile) return request.method === 'GET' ? serveBrandFile(sql, env.ASSETS ?? null, env.IMAGES ?? null, partnerId, brandFile, new Date()) : notFound()
    if (isStoreAuthPath(url.pathname)) {
      const limiter = env.SIGN_IN_RATE_LIMITER
      if (!limiter) return misconfigured('SIGN_IN_RATE_LIMITER')
      return handleStoreAuth(request, { sql, activity: activityLog, partnerId, host: url.host, secrets, now: () => new Date(), allowAttempt: async (key) => (await limiter.limit({ key })).success, codeCheck: config.CODE_CHECK })
    }
    const facts = factsOf(request)
    const standing = await resolveStoreStanding(sql, request, partnerId, new Date(), activityLog, facts)
    const context = { standing, partnerId, sql, activity: activityLog, facts, secrets, host: url.host, shopify: shopConnectOf(shopifyFor(config)), couriers: config.COURIERS_LOCAL === '1' ? localCouriers() : null, payments: paymentsFor(config), codeCheck: config.CODE_CHECK, now: () => new Date() }
    if (isAssetsPath(url.pathname)) return handleAssets(request, context, env.ASSETS ?? null)
    return servers.store.fetch(request, context)
  })
}

// SNS signs with few certificates; one verifier per isolate fetches each once.
let snsBuilt: SnsVerifier | undefined

// hooks.dripfunnel.com: Stripe's billing events (SAAS §7.2) and SES's bounces and complaints
// (THIRD-PARTY-ACCESS.md §2.4). A route whose values aren't set doesn't exist.
const handleHooks = async (request: Request, url: URL, config: Config, env: Env, ctx: ExecutionContext): Promise<Response> => {
  if (url.pathname === shopifyCallbackPath) {
    const shopify = shopifyFor(config)
    const secrets = await secretsFor(config)
    if (!shopify || !secrets) return notFound()
    if (!config.HYPERDRIVE) return new Response(null, { status: 503 })
    return withConnection(config.HYPERDRIVE, ctx, (sql) => handleShopifyCallback(request, { sql, api: shopify.api, secrets, activity: activityLog, now: () => new Date() }))
  }
  if (url.pathname === sesHookPath) {
    const topicArn = config.SES_EVENTS_TOPIC_ARN
    const suppressionKey = config.EMAIL_SUPPRESSION_KEY
    if (!topicArn || !suppressionKey) return notFound()
    if (!config.HYPERDRIVE) return new Response(null, { status: 503 })
    snsBuilt ??= snsVerifier()
    const verifier = snsBuilt
    return withConnection(config.HYPERDRIVE, ctx, (sql) => handleSesHook(request, { sql, verifier, topicArn, suppressionKey, now: () => new Date() }))
  }
  const payments = paymentsFor(config)
  const paymentHook = paymentHookOf(url.pathname)
  if (paymentHook) {
    if (!config.HYPERDRIVE) return new Response(null, { status: 503 })
    const secrets = await (secretsFor(config) ?? null)
    const limiter = env.SHOP_RATE_LIMITER
    if (!limiter) return misconfigured('SHOP_RATE_LIMITER')
    const allow = async (key: string) => (await limiter.limit({ key })).success
    return withConnection(config.HYPERDRIVE, ctx, (sql) => handlePaymentHook(request, paymentHook, { sql, activity: activityLog, gateways: payments.gateways, secrets, now: () => new Date() }, allow))
  }
  if (url.pathname === stripeConnectCallbackPath) {
    const connect = payments.stripeConnect
    if (!connect) return notFound()
    if (!config.HYPERDRIVE) return new Response(null, { status: 503 })
    return withConnection(config.HYPERDRIVE, ctx, (sql) => handleStripeConnectCallback(request, { sql, connect, activity: activityLog, now: () => new Date() }))
  }
  const stripe = stripeFor(config)
  const signingSecret = config.STRIPE_WEBHOOK_SECRET
  if (url.pathname !== stripeHookPath || !stripe || !signingSecret) return notFound()
  const hyperdrive = config.HYPERDRIVE
  // Stripe delivers again after a 503, so nothing is lost while the database is away.
  if (!hyperdrive) return new Response(null, { status: 503 })
  const secrets = await (secretsFor(config) ?? null)
  return withConnection(hyperdrive, ctx, (sql) =>
    handleStripeHook(request, { sql, stripe, signingSecret, payments: { sql, activity: activityLog, gateways: payments.gateways, secrets, now: () => new Date() }, now: () => new Date() }),
  )
}

// The data centre's own cache; absent off Cloudflare (tests), where every request runs.
const shopCache = (): ShopCache | null => (typeof caches !== 'undefined' && 'default' in caches ? (caches as CacheStorage & { default: ShopCache }).default : null)

const shopRefusal = (status: number, code: string, message: string) =>
  new Response(JSON.stringify({ errors: [{ message, extensions: { code } }] }), { status, headers: { 'content-type': 'application/json' } })

// A storefront host (docs/ARCHITECTURE.md §2): the store comes from the host or the public store key, and a host no store
// holds answers 404, as a portal host no partner holds does.
const handleShop = async (request: Request, url: URL, config: Config, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const facts = factsOf(request)
  const hyperdrive = config.HYPERDRIVE
  if (!hyperdrive) return servers.shop.fetch(request, { sql: null, shopper: null, origin: url.origin, activity: activityLog, facts, allowNewCart: async () => false, now: () => new Date() })
  const limiter = env.SHOP_RATE_LIMITER
  if (!limiter) return misconfigured('SHOP_RATE_LIMITER')
  const carts = env.CART_RATE_LIMITER
  if (!carts) return misconfigured('CART_RATE_LIMITER')
  // Keyed per address, never pooled, as sign-in is; Cloudflare sets the header on all real traffic.
  if (!facts.ip || !(await limiter.limit({ key: `shop:${url.hostname}:${facts.ip}` })).success) return shopRefusal(429, 'RATE_LIMITED', 'Too many requests. Try again in a minute.')
  return withConnection(hyperdrive, ctx, async (sql) => {
    const found = await resolveShopper(sql, request, url.hostname)
    if (found.kind === 'key-mismatch') return shopRefusal(403, 'WRONG_STORE_KEY', 'This key is for another shop.')
    if (found.kind === 'unknown') return notFound()
    const context: ShopContext = { sql, shopper: found.shopper, origin: url.origin, activity: activityLog, facts, couriers: config.COURIERS_LOCAL === '1' ? localCouriers() : null, payments: paymentsFor(config), secrets: await (secretsFor(config) ?? null), allowAttempt: async (key) => (env.SIGN_IN_RATE_LIMITER ? (await env.SIGN_IN_RATE_LIMITER.limit({ key })).success : false), allowNewCart: async (key) => (await carts.limit({ key })).success, codeCheck: config.CODE_CHECK, sessionToken: request.headers.get(shopSessionHeader), now: () => new Date() }
    if (isShopAssetPath(url.pathname)) return handleShopAsset(request, context, env.ASSETS ?? null)
    const key = found.shopper.available ? await shopCacheKey(request, found.shopper, url.hostname) : null
    return throughShopCache(shopCache(), key, () => servers.shop.fetch(request, context), (work) => ctx.waitUntil(work))
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
  if (!area) return { response: notFound(), area: null }
  if (area === 'hooks') return { response: await handleHooks(request, url, config, env, ctx), area }
  if (isHealthPath(area, url.pathname)) {
    return { response: await handleHealthCheck(request, area, config, ctx, env.HEALTH_RATE_LIMITER, env.CF_VERSION_METADATA.id, env.ASSETS !== undefined), area }
  }
  if (area === 'admin') return { response: await handleAdmin(request, url, config, env, ctx), area }
  if (area === 'platform') return { response: await handlePlatform(request, url, config, env, ctx), area }
  if (area === 'store') return { response: await handleStore(request, url, config, env, ctx), area }
  return { response: await handleShop(request, url, config, env, ctx), area }
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

export interface OutboxWake {
  at: number
}
const readMethods = new Set(['GET', 'HEAD', 'OPTIONS'])
/** After a write that succeeded, asks the relay to run now instead of at the next cron; a refused request queued nothing. */
export const wakeOutbox = (request: Request, response: Response, env: Env, ctx: ExecutionContext): void => {
  if (!env.OUTBOX_WAKE || readMethods.has(request.method) || response.status < 200 || response.status >= 300) return
  ctx.waitUntil(
    env.OUTBOX_WAKE.send({ at: Date.now() }).catch((error: unknown) => {
      logEvent({ event: 'outbox_wake_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    }),
  )
}

// Delivers what is due (api/README.md §5): cron's sweep and each batch of wakes both call it.
const sweepOutbox = (env: Env): Promise<void> =>
  relayWith(env, async (sql, config) => {
    const counts = await relayDue(sql, deliverersFor(sql, config, env.ASSETS ?? null, await secretsFor(config)))
    for (const [outcome, count] of Object.entries(counts)) {
      if (count > 0) logEvent({ event: 'outbox_relay', api: 'system', code: outcome, count })
    }
  })

// Cron only: schedules and cleanups that nothing waits on, then the sweep above.
const sweepSchedules = (env: Env): Promise<void> =>
  relayWith(env, async (sql, config) => {
    // A scheduling failure is logged and never holds up the outbox sweep below.
    const due = await queueDueDomainChecks(sql, new Date()).catch((error: unknown) => {
      logEvent({ event: 'domain_checks_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
      return 0
    })
    if (due > 0) logEvent({ event: 'domain_checks_queued', api: 'system', code: 'scheduled', count: due })
    await queueRatesRefresh(sql, new Date()).catch((error: unknown) => {
      logEvent({ event: 'rates_refresh_queue_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    })
    const purged = await withSystemScope(sql, async (tx) => {
      const at = new Date()
      await failDeadExports(tx, at, new Date(at.getTime() + exportLifetimeMs))
      await failDeadCatalogExports(tx, at, new Date(at.getTime() + exportLifetimeMs))
      await failDeadImports(tx, at, new Date(at.getTime() + exportLifetimeMs))
      await deleteStalePendingConnections(tx, at)
      await deleteAbandonedConnections(tx, at)
      return (await deleteExpiredExports(tx, at)) + (await deleteExpiredCatalogExports(tx, at)) + (await deleteExpiredImports(tx, at))
    }).catch((error: unknown) => {
      logEvent({ event: 'exports_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
      return 0
    })
    if (purged > 0) logEvent({ event: 'exports_purged', api: 'system', code: 'expired', count: purged })
    // Bank transfers unpaid after 3 days and card payments not completed in a day are cancelled, their stock released (FIRST-RELEASE §1).
    const settle = { sql, activity: activityLog, gateways: paymentsFor(config).gateways, secrets: await (secretsFor(config) ?? null), now: () => new Date() }
    const released = await releaseUnpaidOrders(settle, new Date()).catch((error: unknown) => {
      logEvent({ event: 'unpaid_orders_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
      return 0
    })
    if (released > 0) logEvent({ event: 'unpaid_orders_cancelled', api: 'system', code: 'unpaid', count: released })
    // Old sign-in codes and sessions go, with the addresses they named.
    await withSystemScope(sql, (tx) => purgeShopperIdentity(tx, new Date(), 500)).catch((error: unknown) => {
      logEvent({ event: 'shopper_identity_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    })
    // Carts past their 30 days go, with whatever address or email a guest left in them.
    await withSystemScope(sql, (tx) => deleteExpiredCarts(tx, new Date(), 500)).catch((error: unknown) => {
      logEvent({ event: 'cart_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    })
    // Sign-ups nobody finished go after their day, with their password hashes (SAAS §4.1).
    await withSystemScope(sql, (tx) => deleteExpiredSignups(tx, new Date(), 500)).catch((error: unknown) => {
      logEvent({ event: 'signup_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    })
    const expired = await withSystemScope(sql, (tx) => expireUnsentSms(tx, new Date(), defaultRelayOptions.leaseMs)).catch((error: unknown) => {
      logEvent({ event: 'sms_expiry_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
      return 0
    })
    if (expired > 0) logEvent({ event: 'sms_expired', api: 'system', code: 'expired', count: expired })
  })

export default {
  async fetch(request, env, ctx) {
    const started = Date.now()
    const { response, area } = await guarded(request, () => route(request, env, ctx))
    wakeOutbox(request, response, env, ctx)
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

  // Every minute from wrangler.jsonc's cron trigger, and the backstop for any wake that never arrives.
  async scheduled(_controller, env) {
    await sweepSchedules(env)
    await sweepOutbox(env)
  },

  // One wake per mutating request (wakeOutbox): a batch of them is one sweep.
  async queue(batch, env) {
    await sweepOutbox(env)
    batch.ackAll()
  },
} satisfies ExportedHandler<Env>
