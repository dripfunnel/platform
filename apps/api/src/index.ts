import type postgres from 'postgres'
import { WorkerEntrypoint } from 'cloudflare:workers'
import { adminSchema, type AdminContext } from '#apis/admin/schema'
import { handleAuth, isAuthPath } from '#apis/admin/auth'
import { createServer } from '#apis/graphql/server'
import { handleHealthCheck, isHealthPath } from '#apis/health'
import { buildsPrefix, handleBuildCall } from '#apis/builds'
import { handlePlatformAuth, isPlatformAuthPath } from '#apis/platform/auth'
import { brandUploadPath, handleBrandUpload } from '#apis/platform/uploads'
import { platformSchema, type PlatformContext } from '#apis/platform/schema'
import { shopSchema, type ShopContext } from '#apis/shop/schema'
import { handleShopAsset, isShopAssetPath } from '#apis/shop/assets'
import { handleDownload, isDownloadPath } from '#apis/shop/downloads'
import { handleVitals, vitalsPath } from '#apis/shop/vitals'
import { shopCacheKey, throughShopCache, type ShopCache } from '#apis/shop/cache'
import { resolveShopper, shopSessionHeader } from '#auth/shopCaller'
import { signedOutStoreContext } from '#apis/store/access'
import { handleStoreAuth, isStoreAuthPath } from '#apis/store/auth'
import { handleSupportSession, isSupportSessionPath } from '#apis/store/supportSession'
import { handleAssets, isAssetsPath } from '#apis/store/assets'
import { handleDocument, isDocumentsPath } from '#apis/store/documents'
import { brandFileOf, serveBrandFile } from '#apis/store/brandFiles'
import { storeSchema, type StoreContext } from '#apis/store/schema'
import { factsOf } from '#auth/activity'
import { isAssigned } from '#auth/assignment'
import { resolvePartner } from '#auth/partnerCaller'
import { resolvePortalPartner, resolveStoreStanding } from '#auth/storeCaller'
import { storeActivityFor } from '#auth/storeSupport'
import { storeOriginAllowed } from '#auth/storeCredential'
import { machineCredentialOf } from '#auth/apiKeys'
import { platformContextFor, signedOutContext } from '#apis/platform/context'
import { partnerCookieName } from '#auth/partnerSession'
import { staffPortalCookieName } from '#auth/staffPortal'
import { passwordResetRequestKind } from '#auth/partnerTokens'
import { userPasswordResetRequestKind } from '#auth/storeTokens'
import { secretBox, type SecretBox } from '#auth/secretBox'
import { linkSigner, type LinkSigner } from '#auth/signedLink'
import { previewLinks, type PreviewLinks } from '#auth/previewLink'
import { resolveStaff } from '#auth/caller'
import { originAllowed, readCookie } from '#auth/cookie'
import type { IdentityProvider } from '#auth/oidc'
import { SignInFailed } from '#auth/oidc'
import { isLocalhost, parseConfig, type Config } from '#core/config'
import { failureCode, logEvent } from '#core/log'
import { getClient } from '#db/client'
import { dohLookup } from '#integrations/dns/doh'
import { localCloudflare, localCouriers, localDns, localEmail, localSms, localWhatsApp } from '#integrations/local/index'
import { whatsappDeliverer } from '#jobs/queues/deliverers/whatsapp'
import { whatsappKind, whatsappMessages, type PartnerWhatsAppAccounts } from '#saas/whatsapp/index'
import { smsDeliverer } from '#jobs/queues/deliverers/sms'
import { ecbRates } from '#integrations/ecb/rates'
import { entraProvider } from '#integrations/entra/provider'
import { storeBillingStripe, stripeClient, type StoreBillingStripe, type StripeApi } from '#integrations/stripe/index'
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
import { cartRemindDeliverer } from '#jobs/queues/deliverers/cartRemind'
import { cartRemindKind, markAbandonedCarts, queueDueReminders } from '#engine/modules/cartReminders/index'
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
import { storeHostSyncDeliverer, storeHostsRegisterDeliverer, storeHostsRemoveDeliverer } from '#jobs/queues/deliverers/storeHost'
import { partnerPasswordResetDeliverer } from '#jobs/queues/deliverers/partnerPasswordReset'
import { userPasswordResetDeliverer } from '#jobs/queues/deliverers/userPasswordReset'
import { deleteExpiredExports, failDeadExports } from '#db/scoped/exportJobs'
import { withSystemScope } from '#db/scoped/index'
import { deleteExpiredSignups } from '#db/scoped/signup'
import { queueDueDomainChecks } from '#jobs/queues/domainSchedule'
import { queueRatesRefresh } from '#jobs/queues/ratesSchedule'
import { releaseUnpaidOrders, type PaymentWiring } from '#engine/modules/checkout/index'
import { publishScheduledPosts } from '#engine/modules/content/index'
import type { PaymentMode } from '#core/payments'
import { stripeConnect } from '#integrations/stripe/connect'
import { stripePayments, type StripeKeys } from '#integrations/stripe/payments'
import { stripeTax } from '#integrations/stripe/tax'
import { handleStripeConnectCallback, stripeConnectCallbackPath } from '#hooks/stripeConnect'
import { courierHookOf, handleCourierHook } from '#hooks/couriers'
import { handlePaymentHook, paymentHookOf } from '#hooks/payments'
import { keyedGateways } from '#integrations/payments/index'
import { deleteExpiredCarts } from '#db/scoped/cart'
import { storeEventKind } from '#db/scoped/storeEvents'
import { deleteOldDeliveries } from '#db/scoped/webhooks'
import { webhookDeliveryKind, webhookReleaseKind } from '#saas/webhooks/index'
import { appNoticeKind } from '#saas/apps/index'
import { storeHostSyncKind, storeHostsRegisterKind, storeHostsRemoveKind } from '#saas/domains/index'
import { webhookDeliveryDeliverer, webhookEventDeliverer, webhookReleaseDeliverer } from '#jobs/queues/deliverers/webhooks'
import { appNoticeDeliverer } from '#jobs/queues/deliverers/appNotice'
import { purgeShopperIdentity } from '#db/scoped/shopper'
import { defaultRelayOptions, relayDue, type Deliverers } from '#jobs/queues/outbox-relay'
import { storefrontCreateDeliverer, type StorefrontWorkflow } from '#jobs/queues/deliverers/storefrontCreate'
import { createStorefrontWorkflow } from '#jobs/workflows/create-storefront'
import { studioCapacityClass, studioSessionClass, type CapacityNamespace, type StudioSessionObject } from '#jobs/durable/studio'
import { handleStudioFrame } from '#apis/studio/frame'
import { frameClosed } from '#saas/studio/index'
import { cachePurgeDeliverer, cachePurgeKind } from '#jobs/queues/deliverers/cachePurge'
import { cachePurgeClient } from '#integrations/cloudflare/purge'
import { checkPreview, cleanStorefronts, lookupLiveHost, readVitalsRegressions, lookupRedirects, openPreview, storefrontIndexNowKind, storefrontPublishKind, storefrontRenderPageKind, type LiveHost, type PreviewAccess, type PublishParams } from '#saas/storefronts/index'
import { storefrontPublishDeliverer, type PublishWorkflow } from '#jobs/queues/deliverers/storefrontPublish'
import { publishStorefrontWorkflow } from '#jobs/workflows/publish-storefront'
import { renderPageWorkflow } from '#jobs/workflows/render-page'
import { coreUpgradeWorkflow } from '#jobs/workflows/core-upgrade'
import { storefrontUpgradeDeliverer, storefrontUpgradePushDeliverer, type UpgradeWorkflow } from '#jobs/queues/deliverers/storefrontUpgrade'
import { advanceRollouts, createFleetService, defaultActionsJobs, retireCoreImages, storefrontUpgradeKind, storefrontUpgradePushKind, type UpgradeParams } from '#saas/fleet/index'
import { indexNowDeliverer } from '#jobs/queues/deliverers/indexNow'
import { storefrontRenderDeliverer, storefrontRenderKind } from '#jobs/queues/deliverers/storefrontRender'
import { indexNowClient } from '#integrations/indexnow/client'
import { githubConfigured, githubFor, storeRepos, type StoreRepos } from '#integrations/github/index'
import { actionsKeys } from '#integrations/github/oidc'
import { storefrontR2, type StorefrontR2 } from '#integrations/cloudflare/r2'
import { localActionsKeys, localStorefrontR2 } from '#integrations/local/builds'
import type { BuildDeps } from '#saas/storefronts/index'
import { storefrontCreateKind, type CreateStorefrontParams } from '#saas/storefronts/index'
import { activityLog } from '#saas/activity/index'
import { endTrials, suspendOverdueStores } from '#saas/storeBilling/index'
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
import { createAppRegistryService } from '#saas/apps/index'
import { resolveArea, type Area, type Entry } from './router'

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
  // "Check a code" in the Store API per person and store, and a shopper's codes per store and IP (SAPI 14); unbound, every one is refused.
  OFFER_CODE_RATE_LIMITER?: RateLimit | undefined
  // A paid order's download links, per shop host and IP (CATALOG-DESIGN T14); unbound, every download is refused.
  DOWNLOAD_RATE_LIMITER?: RateLimit | undefined
  // Every request carrying an API key, per address, before the key is looked up (ACCESS.md §9 check 13); unbound, keys answer 500.
  API_RATE_LIMITER?: RateLimit | undefined
  // A store build's calls, per address, before the token is checked (storefront LIVE-SHOP.md §9); unbound, they answer 500.
  BUILD_RATE_LIMITER?: RateLimit | undefined
  // Bound only where the bucket exists (THIRD-PARTY-ACCESS.md §2.1); uploads answer NOT_CONNECTED otherwise.
  ASSETS?: R2Bucket | undefined
  IMAGES?: ImagesBinding | undefined
  // Wakes the outbox relay after a request (api/README.md §5); unbound, cron delivers.
  OUTBOX_WAKE?: Queue<OutboxWake> | undefined
  // SAAS §5 steps 4–8 and the bucket its templates and previews are in; unbound, a store's first template choice waits in the outbox.
  CREATE_STOREFRONT?: Workflow<CreateStorefrontParams> | undefined
  STOREFRONT_SITES?: R2Bucket | undefined
  // The other two storefront buckets (storefront LIVE-SHOP.md §2): built JS and CSS behind the asset host, and the private drafts.
  STOREFRONT_ASSETS?: R2Bucket | undefined
  STOREFRONT_DRAFTS?: R2Bucket | undefined
  // SAAS §9.1's publish-storefront Workflow; unbound, a publish waits in the outbox.
  PUBLISH_STOREFRONT?: Workflow<PublishParams> | undefined
  RENDER_PAGE?: Workflow<PublishParams> | undefined
  // SAAS §10's upgrade bot, one instance per store in a rollout (jobs/workflows/core-upgrade.ts).
  CORE_UPGRADE?: Workflow<UpgradeParams> | undefined
  // The studio (storefront AI-STUDIO.md §2): a StudioSession per store, holding its container, and the account's StudioCapacity.
  STUDIO_SESSION?: DurableObjectNamespace | undefined
  STUDIO_CAPACITY?: CapacityNamespace | undefined
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

// Locally (SMS_LOCAL) every partner has a WhatsApp number with both cart templates, which the stand-in prints (#275 sets the real ones).
const localWhatsAppAccounts: PartnerWhatsAppAccounts = {
  forPartner: async () => ({ authKey: 'local', integratedNumber: 'local', language: 'en', templates: Object.fromEntries(whatsappMessages.map((m) => [m, m.replace('.', '_')])) }),
}

// Asked for, the stand-in wins (EMAIL_LOCAL; config refuses it anywhere but localhost), as Shopify's does; else SES
// where its values are set; else email waits in the outbox.
const emailFor = (config: Config) => {
  if (config.EMAIL_LOCAL === '1' && config.EMAIL_SUPPRESSION_KEY) return { api: localEmail(), senderDomain: config.SES_SENDER_DOMAIN ?? 'mail.localhost', suppressionKey: config.EMAIL_SUPPRESSION_KEY }
  return sesFor(config)
}

// The side effects the relay can deliver. `email` waits, unclaimed, until SES (or locally its stand-in) is configured
// (outbox-relay.ts); `sms` likewise until partners' accounts exist (#275), or locally SMS_LOCAL.
// The DNS every check of a user's address asks: the local stand-in only where asked for (docs/setup/local.md §6).
const lookupFor = (sql: postgres.Sql, config: Config) => (config.DNS_LOCAL === '1' ? localDns(sql, dohLookup()) : dohLookup())

const deliverersFor = (sql: postgres.Sql, config: Config, assets: R2Bucket | null, secrets: SecretBox | null, downloadLinks: LinkSigner | null, createStorefront: StorefrontWorkflow | null, publishing: { publish: PublishWorkflow; render: PublishWorkflow; sites: R2Bucket; drafts: R2Bucket; repos: StoreRepos; upgrade: UpgradeWorkflow | null } | null): Deliverers => {
  const lookup = lookupFor(sql, config)
  const ses = emailFor(config)
  const client = config.CF_CUSTOM_HOSTNAMES_TOKEN && config.CF_SAAS_ZONE_ID ? cloudflareClient({ token: config.CF_CUSTOM_HOSTNAMES_TOKEN, zoneId: config.CF_SAAS_ZONE_ID }) : null
  const cloudflare = client && config.DNS_LOCAL === '1' ? localCloudflare(client) : client
  return {
    [collectionsRecomputeKind]: collectionsRecomputeDeliverer(sql),
    ...(ses ? { email: emailDeliverer(sql, ses.api, { hosts: { adminHost: config.ADMIN_HOST, platformHost: config.PLATFORM_HOST, downloadLinks }, senderDomain: ses.senderDomain, suppressionKey: ses.suppressionKey }) } : {}),
    // A cart reminder is decided as email is sent, so it waits with it until SES is configured.
    ...(ses ? { [cartRemindKind]: cartRemindDeliverer(sql, ses.suppressionKey, config.SMS_LOCAL === '1' ? localWhatsAppAccounts : null) } : {}),
    ...(config.SMS_LOCAL === '1' && ses ? { [whatsappKind]: whatsappDeliverer(sql, localWhatsAppAccounts, localWhatsApp, ses.suppressionKey) } : {}),
    ...(config.SMS_LOCAL === '1' ? { [smsKind]: smsDeliverer(sql, localSmsAccounts, { msg91: localSms, twilio: localSms }) } : {}),
    'domain.recheck': domainRecheckDeliverer(sql, lookup, () => new Date(), cloudflare),
    ...(cloudflare ? { 'domain.remove': domainRemoveDeliverer(sql, cloudflare) } : {}),
    ...(cloudflare ? { [storeHostSyncKind]: storeHostSyncDeliverer(sql, cloudflare) } : {}),
    [storeHostsRegisterKind]: storeHostsRegisterDeliverer(sql),
    [storeHostsRemoveKind]: storeHostsRemoveDeliverer(sql),
    'custom_domain.recheck': customDomainRecheckDeliverer(sql, lookup, () => new Date(), cloudflare),
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
    [storeEventKind]: webhookEventDeliverer(sql),
    [webhookDeliveryKind]: webhookDeliveryDeliverer(sql, { lookup, secrets }),
    [webhookReleaseKind]: webhookReleaseDeliverer(sql),
    [appNoticeKind]: appNoticeDeliverer(sql, { lookup, secrets }),
    ...(createStorefront ? { [storefrontCreateKind]: storefrontCreateDeliverer(createStorefront) } : {}),
    ...(publishing
      ? {
          [storefrontPublishKind]: storefrontPublishDeliverer(publishing.publish),
          [storefrontRenderPageKind]: storefrontPublishDeliverer(publishing.render),
          [storefrontRenderKind]: storefrontRenderDeliverer(sql, () => new Date()),
          [storefrontUpgradePushKind]: storefrontUpgradePushDeliverer(sql, publishing.repos, publishing.drafts),
          ...(publishing.upgrade ? { [storefrontUpgradeKind]: storefrontUpgradeDeliverer(publishing.upgrade) } : {}),
          [storefrontIndexNowKind]: indexNowDeliverer(sql, publishing.sites, indexNowClient()),
        }
      : {}),
    ...(config.CF_CACHE_PURGE_TOKEN && config.CF_SAAS_ZONE_ID ? { [cachePurgeKind]: cachePurgeDeliverer(cachePurgeClient({ token: config.CF_CACHE_PURGE_TOKEN, zoneId: config.CF_SAAS_ZONE_ID })) } : {}),
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
    return servers.admin.fetch(request, { staff: null, isAssigned: async () => false, staffActivity: null, partners: null, stores: null, staffMembers: null, customers: null, staffSessions: null, provisioning: null, dashboard: null, apps: null, fleet: null })
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
      apps: caller ? createAppRegistryService({ sql, staff: caller.staff, facts: factsOf(request), activity: activityLog, secrets: await (secretsFor(config) ?? null), lookup: lookupFor(sql, config), now: () => new Date() }) : null,
      fleet: caller ? createFleetService({ sql, staff: caller.staff, facts: factsOf(request), activity: activityLog, now: () => new Date() }) : null,
      dashboard: caller ? createDashboardService({ sql, staff: caller.staff, now: () => new Date() }) : null,
    })
  })
}

// Built once per isolate from configuration, like the identity provider.
let stripeBuilt: { key: string; api: StripeApi & StoreBillingStripe } | undefined

const stripeFor = (config: Config): (StripeApi & StoreBillingStripe) | null => {
  const key = config.STRIPE_SECRET_KEY
  if (!key) return null
  if (stripeBuilt?.key !== key) stripeBuilt = { key, api: { ...stripeClient({ secretKey: key }), ...storeBillingStripe({ secretKey: key }) } }
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

let previewKey: { key: string; links: Promise<PreviewLinks> } | undefined
const previewLinksFor = (config: Config): Promise<PreviewLinks> | null => {
  const key = config.PREVIEW_LINK_KEY
  if (!key) return null
  if (previewKey?.key !== key) previewKey = { key, links: previewLinks(key) }
  return previewKey.links
}
/** "Open preview" needs both the preview domain and the link's key (storefront PREVIEW.md §5 step 1, §8). */
const previewFor = async (config: Config): Promise<{ domain: string; links: PreviewLinks } | null> => {
  const links = previewLinksFor(config)
  return config.PREVIEW_DOMAIN && links ? { domain: config.PREVIEW_DOMAIN, links: await links } : null
}

let linkKey: { key: string; signer: Promise<LinkSigner> } | undefined

/** A paid order's download links, signed under CREDENTIALS_KEK (auth/signedLink.ts). */
const downloadLinksFor = (config: Config): Promise<LinkSigner> | null => {
  const key = config.CREDENTIALS_KEK
  if (!key) return null
  if (linkKey?.key !== key) linkKey = { key, signer: linkSigner(key, 'download-links') }
  return linkKey.signer
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

// A key over its plan's calls, or an address sending too many keys (decided on #337).
const tooManyRequests = (retryAfterSeconds: number) =>
  new Response(JSON.stringify({ errors: [{ message: 'Too many requests. Try again later.', extensions: { code: 'RATE_LIMITED' } }] }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': String(retryAfterSeconds) },
  })

// A partner's portal host (docs/ARCHITECTURE.md §2): a host no partner holds answers 404, and the
// caller is the session's person acting in the store the request names (ACCESS.md §4).
const handleStore = async (request: Request, url: URL, config: Config, env: Env, ctx: ExecutionContext, entry: Entry): Promise<Response> => {
  if (!isStoreAuthPath(url.pathname) && !storeOriginAllowed(request, url.host)) return new Response('Bad origin', { status: 403 })
  const hyperdrive = config.HYPERDRIVE
  if (!hyperdrive) return entry === 'portal' ? notFound() : servers.store.fetch(request, signedOutStoreContext(factsOf(request), activityLog))
  const secrets = await secretsFor(config)
  return withConnection(hyperdrive, ctx, async (sql) => {
    const partnerId = await resolvePortalPartner(sql, url.hostname)
    if (!partnerId) return notFound()
    const brandFile = brandFileOf(url.pathname)
    if (brandFile) return request.method === 'GET' ? serveBrandFile(sql, env.ASSETS ?? null, env.IMAGES ?? null, partnerId, brandFile, new Date()) : notFound()
    if (isSupportSessionPath(url.pathname)) {
      const exchangeLimiter = env.SIGN_IN_RATE_LIMITER
      const readLimiter = env.STAFF_SESSION_RATE_LIMITER
      if (!exchangeLimiter) return misconfigured('SIGN_IN_RATE_LIMITER')
      if (!readLimiter) return misconfigured('STAFF_SESSION_RATE_LIMITER')
      return handleSupportSession(request, url, {
        sql,
        partnerId,
        activity: activityLog,
        now: () => new Date(),
        allowExchange: async (key) => (await exchangeLimiter.limit({ key })).success,
        allowRead: async (key) => (await readLimiter.limit({ key })).success,
      })
    }
    if (isStoreAuthPath(url.pathname)) {
      const limiter = env.SIGN_IN_RATE_LIMITER
      if (!limiter) return misconfigured('SIGN_IN_RATE_LIMITER')
      return handleStoreAuth(request, { sql, activity: activityLog, partnerId, host: url.host, secrets, now: () => new Date(), allowAttempt: async (key) => (await limiter.limit({ key })).success, codeCheck: config.CODE_CHECK })
    }
    const facts = factsOf(request)
    if (machineCredentialOf(request) !== null) {
      const limiter = env.API_RATE_LIMITER
      if (!limiter) return misconfigured('API_RATE_LIMITER')
      const ip = request.headers.get('cf-connecting-ip')
      if (!ip || !(await limiter.limit({ key: `api-key:${ip}` })).success) return tooManyRequests(60)
    }
    const standing = await resolveStoreStanding(sql, request, partnerId, new Date(), activityLog, facts)
    if (standing.kind === 'limited') return tooManyRequests(standing.retryAfterSeconds)
    const context = { standing, partnerId, sql, activity: storeActivityFor(standing, activityLog), facts, secrets, lookup: lookupFor(sql, config), host: url.host, shopify: shopConnectOf(shopifyFor(config)), couriers: config.COURIERS_LOCAL === '1' ? localCouriers() : null, files: env.ASSETS ?? null, payments: paymentsFor(config), billing: stripeFor(config), codeCheck: config.CODE_CHECK,
      allowCodeCheck: async (key: string) => (env.OFFER_CODE_RATE_LIMITER ? (await env.OFFER_CODE_RATE_LIMITER.limit({ key })).success : false),
      allowPublicRead: async (key: string) => (env.SHOP_RATE_LIMITER ? (await env.SHOP_RATE_LIMITER.limit({ key })).success : false),
      preview: await previewFor(config), domains: { edgeZone: config.EDGE_ZONE, localHosts: config.DNS_LOCAL === '1' }, now: () => new Date() }
    if (isAssetsPath(url.pathname)) return handleAssets(request, context, env.ASSETS ?? null)
    if (isDocumentsPath(url.pathname)) return handleDocument(request, context, env.ASSETS ?? null)
    return servers.store.fetch(request, context)
  })
}

// SNS signs with few certificates; one verifier per isolate fetches each once.
let snsBuilt: SnsVerifier | undefined

// GitHub's OIDC keys, cached per isolate (integrations/github/oidc.ts); the R2 client is rebuilt only when its values change.
let actionsKeysBuilt: ReturnType<typeof actionsKeys> | undefined
let r2Built: { key: string; r2: StorefrontR2 } | undefined

/** A store build's calls (LIVE-SHOP §4 steps 5–9): the stand-ins where asked for, else all six R2 values; null, no route. */
const buildDepsFor = (config: Config, env: Env): Omit<BuildDeps, 'sql'> | null => {
  const sites = env.STOREFRONT_SITES
  const publish = env.PUBLISH_STOREFRONT
  if (!sites || !publish) return null
  // The report and "uploaded" wake the build's own run, whose instance is named by the build id: a publish's, or a page
  // run's (jobs/workflows/render-page.ts).
  const render = env.RENDER_PAGE
  const wake = async (buildId: string, event: 'reported' | 'uploaded') => {
    const instance = await publish.get(buildId).catch((error: unknown) => (render ? render.get(buildId) : Promise.reject(error)))
    await instance.sendEvent({ type: event, payload: null })
  }
  const common = { audience: `https://${config.HOOKS_HOST}`, org: config.GITHUB_STORE_ORG, sites, wake, now: () => new Date() }
  if (config.GITHUB_LOCAL === '1') return { ...common, keys: localActionsKeys, r2: localStorefrontR2(), buckets: { sites: 'storefront-sites-local', drafts: 'storefront-drafts-local' } }
  const { R2_STOREFRONT_ACCOUNT_ID: accountId, R2_STOREFRONT_ACCESS_KEY_ID: accessKeyId, R2_STOREFRONT_SECRET_ACCESS_KEY: secretAccessKey, R2_STOREFRONT_API_TOKEN: apiToken } = config
  const { STOREFRONT_SITES_BUCKET: sitesBucket, STOREFRONT_DRAFTS_BUCKET: draftsBucket } = config
  if (!accountId || !accessKeyId || !secretAccessKey || !apiToken || !sitesBucket || !draftsBucket) return null
  const key = `${accountId}:${accessKeyId}:${secretAccessKey}:${apiToken}`
  if (r2Built?.key !== key) r2Built = { key, r2: storefrontR2({ accountId, accessKeyId, secretAccessKey, apiToken }) }
  actionsKeysBuilt ??= actionsKeys()
  return { ...common, keys: actionsKeysBuilt, r2: r2Built.r2, buckets: { sites: sitesBucket, drafts: draftsBucket } }
}

// hooks.dripfunnel.com: Stripe's billing events (SAAS §7.2) and SES's bounces and complaints
// (THIRD-PARTY-ACCESS.md §2.4). A route whose values aren't set doesn't exist.
const handleHooks = async (request: Request, url: URL, config: Config, env: Env, ctx: ExecutionContext): Promise<Response> => {
  if (url.pathname.startsWith(buildsPrefix)) {
    const deps = buildDepsFor(config, env)
    if (!deps) return notFound()
    if (!config.HYPERDRIVE) return new Response(null, { status: 503 })
    const limiter = env.BUILD_RATE_LIMITER
    if (!limiter) return misconfigured('BUILD_RATE_LIMITER')
    return withConnection(config.HYPERDRIVE, ctx, (sql) => handleBuildCall(request, { ...deps, sql }, async (key) => (await limiter.limit({ key })).success))
  }
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
  const courierHook = courierHookOf(url.pathname)
  if (courierHook) {
    if (!config.HYPERDRIVE) return new Response(null, { status: 503 })
    const limiter = env.SHOP_RATE_LIMITER
    if (!limiter) return misconfigured('SHOP_RATE_LIMITER')
    const couriers = config.COURIERS_LOCAL === '1' ? localCouriers() : null
    return withConnection(config.HYPERDRIVE, ctx, (sql) => handleCourierHook(request, courierHook, { sql, activity: activityLog, couriers }, async (key) => (await limiter.limit({ key })).success))
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
    handleStripeHook(request, { sql, stripe, signingSecret, payments: { sql, activity: activityLog, gateways: payments.gateways, secrets, now: () => new Date() }, activity: activityLog, now: () => new Date() }),
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
    const found = await resolveShopper(sql, request, url.hostname, config.PREVIEW_DOMAIN ?? null)
    if (found.kind === 'key-mismatch') return shopRefusal(403, 'WRONG_STORE_KEY', 'This key is for another shop.')
    if (found.kind === 'unknown') return notFound()
    const context: ShopContext = { sql, shopper: found.shopper, origin: url.origin, activity: activityLog, facts, couriers: config.COURIERS_LOCAL === '1' ? localCouriers() : null, payments: paymentsFor(config), secrets: await (secretsFor(config) ?? null), allowAttempt: async (key) => (env.SIGN_IN_RATE_LIMITER ? (await env.SIGN_IN_RATE_LIMITER.limit({ key })).success : false), allowNewCart: async (key) => (await carts.limit({ key })).success, allowCodeAttempt: async (key) => (env.OFFER_CODE_RATE_LIMITER ? (await env.OFFER_CODE_RATE_LIMITER.limit({ key })).success : false), codeCheck: config.CODE_CHECK, sessionToken: found.shopper.preview ? null : request.headers.get(shopSessionHeader), downloadLinks: await (downloadLinksFor(config) ?? null), allowDownload: async (key) => (env.DOWNLOAD_RATE_LIMITER ? (await env.DOWNLOAD_RATE_LIMITER.limit({ key })).success : false), now: () => new Date() }
    if (isShopAssetPath(url.pathname)) return handleShopAsset(request, context, env.ASSETS ?? null)
    if (isDownloadPath(url.pathname)) return handleDownload(request, context, env.ASSETS ?? null)
    if (url.pathname === vitalsPath) return handleVitals(request, context)
    const key = found.shopper.available ? await shopCacheKey(request, found.shopper, url.hostname) : null
    return throughShopCache(shopCache(), key, () => servers.shop.fetch(request, context), (work) => ctx.waitUntil(work))
  })
}

// The studio frame on a preview host (storefront AI-STUDIO §3 step 6): the host's store's Durable Object, or nothing.
const studioFrame = async (request: Request, config: Config, env: Env, ctx: ExecutionContext): Promise<Response> => {
  const namespace = env.STUDIO_SESSION as DurableObjectNamespace<StudioSessionObject> | undefined
  if (!config.HYPERDRIVE || !namespace) return frameClosed()
  return withConnection(config.HYPERDRIVE, ctx, (sql) =>
    handleStudioFrame(request, {
      sql,
      previewDomain: config.PREVIEW_DOMAIN ?? null,
      studioFor: (storeId) => {
        const stub = namespace.get(namespace.idFromName(storeId))
        return { check: (forStore, session) => stub.check(forStore, session), fetch: (r) => stub.fetch(r) }
      },
      shop: (r) => handleShop(r, new URL(r.url), config, env, ctx),
    }),
  )
}

const route = async (request: Request, env: Env, ctx: ExecutionContext, entry: Entry): Promise<{ response: Response; area: Area | null }> => {
  const url = new URL(request.url)
  let config
  try {
    config = parseConfig(env)
  } catch {
    console.error(JSON.stringify({ code: 'config_invalid' }))
    return { response: new Response(null, { status: 500 }), area: null }
  }
  const area = resolveArea(url, config, entry)
  if (!area) return { response: notFound(), area: null }
  if (area === 'hooks') return { response: await handleHooks(request, url, config, env, ctx), area }
  if (area === 'studio') return { response: await studioFrame(request, config, env, ctx), area }
  // Through PortalProxy nothing answers before the host is found among the live portal rows.
  if (entry === 'public' && isHealthPath(area, url.pathname)) {
    return { response: await handleHealthCheck(request, area, config, ctx, env.HEALTH_RATE_LIMITER, env.CF_VERSION_METADATA.id, env.ASSETS !== undefined), area }
  }
  if (area === 'admin') return { response: await handleAdmin(request, url, config, env, ctx), area }
  if (area === 'platform') return { response: await handlePlatform(request, url, config, env, ctx), area }
  if (area === 'store') return { response: await handleStore(request, url, config, env, ctx, entry), area }
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

// Delivers what is due (api/README.md §5): the every-minute cron and each batch of wakes both call it.
const relayOutbox = async (sql: postgres.Sql, config: Config, env: Env): Promise<void> => {
  // A run needs GitHub and the templates' bucket, so without either the choice waits rather than fails.
  const createStorefront = env.CREATE_STOREFRONT && env.STOREFRONT_SITES && githubConfigured(config) ? env.CREATE_STOREFRONT : null
  // A publish freezes its input in the drafts bucket, starts the build through GitHub and reads the build's folders.
  const github = env.PUBLISH_STOREFRONT && env.RENDER_PAGE && env.STOREFRONT_SITES && env.STOREFRONT_ASSETS && env.STOREFRONT_DRAFTS ? await githubFor(config) : null
  // The upgrade bot also needs the studio's sandbox, so it waits without one (SAAS §10).
  const publishing =
    env.PUBLISH_STOREFRONT && env.RENDER_PAGE && env.STOREFRONT_SITES && env.STOREFRONT_DRAFTS && github
      ? {
          publish: env.PUBLISH_STOREFRONT,
          render: env.RENDER_PAGE,
          sites: env.STOREFRONT_SITES,
          drafts: env.STOREFRONT_DRAFTS,
          repos: storeRepos(github.session(), config.GITHUB_STORE_ORG),
          upgrade: env.CORE_UPGRADE && env.STUDIO_SESSION ? env.CORE_UPGRADE : null,
        }
      : null
  const counts = await relayDue(sql, deliverersFor(sql, config, env.ASSETS ?? null, await secretsFor(config), await (downloadLinksFor(config) ?? null), createStorefront, publishing))
  for (const [outcome, count] of Object.entries(counts)) {
    if (count > 0) logEvent({ event: 'outbox_relay', api: 'system', code: outcome, count })
  }
}
const sweepOutbox = (env: Env): Promise<void> => relayWith(env, (sql, config) => relayOutbox(sql, config, env))

// The cron's jobs (api/README.md §5.1). Each catches and logs its own failure, so one never stops the rest of its group.
type CronJob = (sql: postgres.Sql, config: Config, env: Env) => Promise<void>
const purgeBatch = 500
const runsPerHour = 60
const runsPerDay = 1440
// A purge capped per batch repeats until a short batch, so a slower cadence deletes as much as every minute did.
const drained = async (batch: () => Promise<number>, rounds: number): Promise<number> => {
  let total = 0
  for (let round = 0; round < rounds; round += 1) {
    const count = await batch()
    total += count
    if (count < purgeBatch) break
  }
  return total
}

const expireSms: CronJob = async (sql) => {
  const expired = await withSystemScope(sql, (tx) => expireUnsentSms(tx, new Date(), defaultRelayOptions.leaseMs)).catch((error: unknown) => {
    logEvent({ event: 'sms_expiry_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return 0
  })
  if (expired > 0) logEvent({ event: 'sms_expired', api: 'system', code: 'expired', count: expired })
}

const queueDomainChecks: CronJob = async (sql) => {
  const due = await queueDueDomainChecks(sql, new Date()).catch((error: unknown) => {
    logEvent({ event: 'domain_checks_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return 0
  })
  if (due > 0) logEvent({ event: 'domain_checks_queued', api: 'system', code: 'scheduled', count: due })
}

const failStuckExports: CronJob = async (sql) => {
  await withSystemScope(sql, async (tx) => {
    const at = new Date()
    await failDeadExports(tx, at, new Date(at.getTime() + exportLifetimeMs))
    await failDeadCatalogExports(tx, at, new Date(at.getTime() + exportLifetimeMs))
    await failDeadImports(tx, at, new Date(at.getTime() + exportLifetimeMs))
  }).catch((error: unknown) => {
    logEvent({ event: 'exports_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
  })
}

// Bank transfers unpaid after 3 days and card payments not completed in a day are cancelled, their stock released (FIRST-RELEASE §1).
const releaseUnpaid: CronJob = async (sql, config) => {
  const settle = { sql, activity: activityLog, gateways: paymentsFor(config).gateways, secrets: await (secretsFor(config) ?? null), now: () => new Date() }
  const released = await releaseUnpaidOrders(settle, new Date()).catch((error: unknown) => {
    logEvent({ event: 'unpaid_orders_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return 0
  })
  if (released > 0) logEvent({ event: 'unpaid_orders_cancelled', api: 'system', code: 'unpaid', count: released })
}

// A core rollout's next stores and phase, or a rolled-back one's stores put back (SAAS §10).
const advanceCoreRollouts: CronJob = async (sql, config) => {
  await advanceRollouts(sql, { actionsJobs: config.GITHUB_ACTIONS_JOBS ?? defaultActionsJobs, now: new Date() }).catch((error: unknown) => {
    logEvent({ event: 'core_rollout_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
  })
}

// Old core versions' studio images retired once no store needs them (AI-STUDIO §9).
const retireOldCoreImages: CronJob = async (sql) => {
  const done = await retireCoreImages(sql, new Date()).catch((error: unknown) => {
    logEvent({ event: 'core_images_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return null
  })
  if (done && done.retired.length > 0) logEvent({ event: 'core_images_retired', api: 'system', code: 'retired', count: done.retired.length })
}

// A scheduled post goes live at its time (FIRST-RELEASE §14); its change waits for the next publish like any edit.
const publishDuePosts: CronJob = async (sql) => {
  const published = await publishScheduledPosts(sql, activityLog, new Date()).catch((error: unknown) => {
    logEvent({ event: 'scheduled_posts_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return 0
  })
  if (published > 0) logEvent({ event: 'scheduled_posts_published', api: 'system', code: 'due', count: published })
}

// FIRST-RELEASE §3.3: a trial that ended without a plan moves to the free plan, or owes one.
const endDueTrials: CronJob = async (sql) => {
  const trials = await endTrials(sql, activityLog, new Date()).catch((error: unknown) => {
    logEvent({ event: 'trial_end_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return { ended: 0, failed: 0 }
  })
  if (trials.ended > 0) logEvent({ event: 'trials_ended', api: 'system', code: 'ended', count: trials.ended })
  if (trials.failed > 0) logEvent({ event: 'trial_end_failed', api: 'system', code: 'store_failed', count: trials.failed })
}

// SAAS §7.3: a store 14 days past due is suspended.
const suspendOverdue: CronJob = async (sql) => {
  const suspended = await suspendOverdueStores(sql, activityLog, new Date()).catch((error: unknown) => {
    logEvent({ event: 'dunning_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return 0
  })
  if (suspended > 0) logEvent({ event: 'stores_suspended', api: 'system', code: 'unpaid', count: suspended })
}

// Carts left in checkout are marked, then each reminder step now due is queued once (FIRST-RELEASE §9).
const markAbandoned: CronJob = async (sql) => {
  const abandoned = await markAbandonedCarts({ sql, now: () => new Date() }, 100).catch((error: unknown) => {
    logEvent({ event: 'abandoned_carts_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return 0
  })
  if (abandoned > 0) logEvent({ event: 'abandoned_carts_marked', api: 'system', code: 'abandoned', count: abandoned })
}

const queueReminders: CronJob = async (sql) => {
  const reminded = await queueDueReminders({ sql, now: () => new Date() }, 200).catch((error: unknown) => {
    logEvent({ event: 'cart_reminders_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return 0
  })
  if (reminded > 0) logEvent({ event: 'cart_reminders_queued', api: 'system', code: 'due', count: reminded })
}

const refreshRates: CronJob = async (sql) => {
  await queueRatesRefresh(sql, new Date()).catch((error: unknown) => {
    logEvent({ event: 'rates_refresh_queue_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
  })
}

const purgeExpiredExports: CronJob = async (sql) => {
  const purged = await withSystemScope(sql, async (tx) => {
    const at = new Date()
    await deleteStalePendingConnections(tx, at)
    await deleteAbandonedConnections(tx, at)
    return (await deleteExpiredExports(tx, at)) + (await deleteExpiredCatalogExports(tx, at)) + (await deleteExpiredImports(tx, at))
  }).catch((error: unknown) => {
    logEvent({ event: 'exports_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return 0
  })
  if (purged > 0) logEvent({ event: 'exports_purged', api: 'system', code: 'expired', count: purged })
}

// Old sign-in codes and sessions go, with the addresses they named.
const purgeShopperSignIns: CronJob = async (sql) => {
  await drained(() => withSystemScope(sql, (tx) => purgeShopperIdentity(tx, new Date(), purgeBatch)), runsPerHour).catch((error: unknown) => {
    logEvent({ event: 'shopper_identity_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
  })
}

// Sign-ups nobody finished go after their day, with their password hashes (SAAS §4.1).
const purgeSignups: CronJob = async (sql) => {
  await drained(() => withSystemScope(sql, (tx) => deleteExpiredSignups(tx, new Date(), purgeBatch)), runsPerHour).catch((error: unknown) => {
    logEvent({ event: 'signup_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
  })
}

// Carts past their 30 days go, with whatever address or email a guest left in them.
const purgeCarts: CronJob = async (sql) => {
  await drained(() => withSystemScope(sql, (tx) => deleteExpiredCarts(tx, new Date(), purgeBatch)), runsPerDay).catch((error: unknown) => {
    logEvent({ event: 'cart_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
  })
}

// The webhook delivery log keeps a month (LOGGING §8's technical logs); replays reach back a week.
const purgeWebhookLog: CronJob = async (sql) => {
  await drained(() => withSystemScope(sql, (tx) => deleteOldDeliveries(tx, new Date(Date.now() - 30 * 86_400_000), purgeBatch)), runsPerDay).catch((error: unknown) => {
    logEvent({ event: 'webhook_log_purge_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
  })
}

// Old builds, preview folders and closed stores' files (storefront LIVE-SHOP §4 step 11); only where all three buckets are bound.
const cleanStorefrontFiles: CronJob = async (sql, _config, env) => {
  const { STOREFRONT_SITES: sites, STOREFRONT_ASSETS: assets, STOREFRONT_DRAFTS: drafts } = env
  if (!sites || !assets || !drafts) return
  const cleaned = await cleanStorefronts(sql, { sites, assets, drafts }, new Date()).catch((error: unknown) => {
    logEvent({ event: 'storefront_cleanup_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
    return null
  })
  if (cleaned && cleaned.builds + cleaned.previews + cleaned.stores > 0) logEvent({ event: 'storefront_cleaned', api: 'system', code: 'cleaned', count: cleaned.builds + cleaned.previews + cleaned.stores })
}

// The real-user vitals regression rule (storefront ARCHITECTURE §9), once a day after the day's samples are in.
const readStorefrontVitals: CronJob = async (sql) => {
  await readVitalsRegressions(sql, new Date()).catch((error: unknown) => {
    logEvent({ event: 'storefront_vitals_failed', api: 'system', code: error instanceof Error ? error.name : 'unknown' })
  })
}

/** wrangler.jsonc's `triggers.crons`, each with the jobs it runs (#477); the outbox relay goes last, since it throws. */
export const cronGroups: Readonly<Record<string, readonly CronJob[]>> = {
  '* * * * *': [expireSms, advanceCoreRollouts, relayOutbox, publishDuePosts],
  '*/5 * * * *': [queueDomainChecks, failStuckExports, releaseUnpaid, endDueTrials, suspendOverdue, markAbandoned, queueReminders],
  '0 * * * *': [refreshRates, purgeExpiredExports, purgeShopperSignIns, purgeSignups],
  '0 3 * * *': [purgeCarts, purgeWebhookLog, cleanStorefrontFiles, readStorefrontVitals, retireOldCoreImages],
}

const runCron = async (cron: string, env: Env): Promise<void> => {
  const jobs = Object.hasOwn(cronGroups, cron) ? cronGroups[cron] : undefined
  if (!jobs) {
    logEvent({ event: 'cron_unknown', api: 'system', code: 'no_group' })
    return
  }
  await relayWith(env, async (sql, config) => {
    for (const job of jobs) await job(sql, config, env)
  })
}

const serve = async (request: Request, env: Env, ctx: ExecutionContext, entry: Entry): Promise<Response> => {
  const started = Date.now()
  const { response, area } = await guarded(request, () => route(request, env, ctx, entry))
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
}

/** A partner's own portal host, reached only through store-proxy's service binding (SAAS.md §8). */
export class PortalProxy extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return serve(request, this.env, this.ctx, 'portal')
  }
}

// The edge's questions, each on its own connection, closed after the answer.
const edgeQuery = async <T>(env: Env, ctx: ExecutionContext, work: (sql: postgres.Sql, config: Config) => Promise<T>): Promise<T> => {
  const config = parseConfig(env)
  if (!config.HYPERDRIVE) throw new Error('storefront edge: no database')
  const sql = getClient(config.HYPERDRIVE)
  try {
    return await work(sql, config)
  } finally {
    ctx.waitUntil(sql.end({ timeout: 5 }))
  }
}

/** store-proxy's storefront half (storefront LIVE-SHOP.md §5, PREVIEW.md §5): its host lookups, and `/shop-api/*` once it has checked the request. */
export class StorefrontEdge extends WorkerEntrypoint<Env> {
  override fetch(request: Request): Promise<Response> {
    return serve(request, this.env, this.ctx, 'edge')
  }

  /** Thrown, never answered as unknown, when the database can't be asked: the edge then caches nothing. */
  liveHost(host: string): Promise<LiveHost> {
    return edgeQuery(this.env, this.ctx, (sql, config) => lookupLiveHost(sql, host, { localhost: isLocalhost(config.HOOKS_HOST) }))
  }

  /** The renamed addresses of the store its hostname named (storefront ARCHITECTURE §8), as one list the edge caches. */
  redirects(storeId: string): Promise<{ redirects: { from: string; to: string; everyLanguage: boolean }[] }> {
    return edgeQuery(this.env, this.ctx, (sql) => lookupRedirects(sql, storeId))
  }

  /** `__open?t=` on a preview host (PREVIEW.md §5 step 2); without the link's key no link opens. */
  openPreview(key: string, token: string): Promise<PreviewAccess> {
    return edgeQuery(this.env, this.ctx, async (sql, config) => {
      const links = previewLinksFor(config)
      return links ? openPreview(sql, await links, key, token, new Date()) : { ok: false }
    })
  }

  /** The full re-check of every HTML and /shop-api request on a preview host (PREVIEW.md §5 step 4). */
  previewAccess(check: unknown): Promise<PreviewAccess> {
    return edgeQuery(this.env, this.ctx, (sql) => checkPreview(sql, check))
  }
}

// Wrangler finds a Workflow's class among the Worker's exports (wrangler.jsonc `workflows`).
export const CreateStorefront = createStorefrontWorkflow(getClient)
export const PublishStorefront = publishStorefrontWorkflow(getClient)
export const RenderPage = renderPageWorkflow(getClient)
export const CoreUpgrade = coreUpgradeWorkflow(getClient)
// Wrangler finds the studio's Durable Object classes among the exports too (wrangler.jsonc `durable_objects`).
export const StudioSession = studioSessionClass(getClient)
export const StudioCapacity = studioCapacityClass()

export default {
  fetch: (request, env, ctx) => serve(request, env, ctx, 'public'),

  // Each of wrangler.jsonc's crons runs its own group; the every-minute one is the backstop for any wake that never arrives.
  async scheduled(controller, env) {
    await runCron(controller.cron, env)
  },

  // One wake per mutating request (wakeOutbox): a batch of them is one sweep.
  async queue(batch, env) {
    await sweepOutbox(env)
    batch.ackAll()
  },
} satisfies ExportedHandler<Env>
