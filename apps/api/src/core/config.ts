import { z } from 'zod'

/** The stock photo sources (`integrations/stockImages`), and the ones the AI uses when `AI_PHOTO_SOURCES` is unset: those whose terms allow it. */
export const photoSources = ['unsplash', 'pexels', 'pixabay', 'openverse', 'commons'] as const
export const aiPhotoSourcesDefault: readonly string[] = ['openverse', 'commons']

const configSchema = z.object({
  ADMIN_HOST: z.string().min(1),
  PLATFORM_HOST: z.string().min(1),
  HOOKS_HOST: z.string().min(1),
  CF_CUSTOM_HOSTNAMES_TOKEN: z.string().min(1).optional(),
  CF_SAAS_ZONE_ID: z.string().min(1).optional(),
  EDGE_ZONE: z.string().min(1).default('dripfunnel.ai'),
  // Purges the edge Worker's cached host lookups by tag on CF_SAAS_ZONE_ID (storefront LIVE-SHOP.md §5 step 1); absent, they expire in 60 seconds.
  CF_CACHE_PURGE_TOKEN: z.string().min(1).optional(),
  // Every store's preview is `{key}.<it>` (storefront PREVIEW.md §8): its own registrable domain, never a console's.
  SHOP_DOMAIN: z.string().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'SHOP_DOMAIN must be a domain such as my-store.one').optional(),
  // Seals the preview link's token (storefront PREVIEW.md §5 step 1): 32 bytes in base64. Absent, "Open preview" answers NOT_CONNECTED.
  PREVIEW_LINK_KEY: z
    .string()
    .refine((value) => /^[A-Za-z0-9+/]{43}=$/.test(value), 'PREVIEW_LINK_KEY must be 32 bytes in base64')
    .optional(),
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }).optional(),
  // Set where the binding exists (#30): a missing binding is then `missing` (503), not `unconfigured`.
  HYPERDRIVE_REQUIRED: z.literal('1').optional(),
  // Worker secrets, never VITE_* (THIRD-PARTY-ACCESS.md §2.5). Absent until the app
  // registration exists, and then every sign-in is refused as `provider_unconfigured`.
  ENTRA_TENANT_ID: z.string().min(1).optional(),
  ENTRA_CLIENT_ID: z.string().min(1).optional(),
  ENTRA_CLIENT_SECRET: z.string().min(1).optional(),
  // The credential key-encryption key (THIRD-PARTY-ACCESS.md §5): 32 bytes in base64. Absent,
  // nothing that reads or writes a 2-factor secret answers (NOT_CONNECTED).
  CREDENTIALS_KEK: z
    .string()
    .refine((value) => /^[A-Za-z0-9+/]{43}=$/.test(value), 'CREDENTIALS_KEK must be 32 bytes in base64')
    .optional(),
  // DripFunnel's Stripe account (THIRD-PARTY-ACCESS.md §2.7), Worker secrets. Absent, billing's
  // writes answer NOT_CONNECTED and the webhook route doesn't exist.
  STRIPE_SECRET_KEY: z.string().regex(/^(rk|sk)_(test|live)_[A-Za-z0-9]+$/, 'STRIPE_SECRET_KEY must be a Stripe secret or restricted key').optional(),
  STRIPE_WEBHOOK_SECRET: z.string().regex(/^whsec_[A-Za-z0-9]+$/, 'STRIPE_WEBHOOK_SECRET must be a webhook signing secret').optional(),
  // Merchants' own Stripe accounts by Connect OAuth (THIRD-PARTY-ACCESS.md §3.1), Worker variables: the platform's
  // `ca_…` id, and the publishable key checkout's card field acts with on the merchant's account.
  STRIPE_CONNECT_CLIENT_ID: z.string().regex(/^ca_[A-Za-z0-9]+$/, 'STRIPE_CONNECT_CLIENT_ID must be a Connect client id').optional(),
  STRIPE_PUBLISHABLE_KEY: z.string().regex(/^pk_(test|live)_[A-Za-z0-9]+$/, 'STRIPE_PUBLISHABLE_KEY must be a publishable key').optional(),
  // Where the keys above are live (prod), test-mode ones for preview storefronts' checkout (storefront ARCHITECTURE §4.1).
  STRIPE_TEST_SECRET_KEY: z.string().regex(/^(rk|sk)_test_[A-Za-z0-9]+$/, 'STRIPE_TEST_SECRET_KEY must be a test-mode secret or restricted key').optional(),
  STRIPE_TEST_PUBLISHABLE_KEY: z.string().regex(/^pk_test_[A-Za-z0-9]+$/, 'STRIPE_TEST_PUBLISHABLE_KEY must be a test-mode publishable key').optional(),
  // The storefront's "Pin on map" (THIRD-PARTY-ACCESS.md §2.12), a Worker variable: a public browser key, restricted by API.
  GOOGLE_MAPS_BROWSER_KEY: z.string().regex(/^AIza[0-9A-Za-z_-]{35}$/, 'GOOGLE_MAPS_BROWSER_KEY must be a Google API key').optional(),
  // A delivery's arrival estimate (THIRD-PARTY-ACCESS.md §2.12), a Worker secret: a server key restricted to the Routes API. Absent, no estimate.
  GOOGLE_MAPS_SERVER_KEY: z.string().regex(/^AIza[0-9A-Za-z_-]{35}$/, 'GOOGLE_MAPS_SERVER_KEY must be a Google API key').optional(),
  // DripFunnel's Amazon SES (THIRD-PARTY-ACCESS.md §2.4), Worker secrets. Without all four, email
  // waits in the outbox. The sender domain is verified in SES; partners' fallbacks are its subdomains.
  SES_REGION: z.string().regex(/^[a-z]{2}(-[a-z]+)+-\d$/, 'SES_REGION must be an AWS region such as eu-west-1').optional(),
  SES_ACCESS_KEY_ID: z.string().min(1).optional(),
  SES_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  SES_SENDER_DOMAIN: z.string().regex(/^(?!-)[a-z0-9-]+(\.[a-z0-9-]+)+$/, 'SES_SENDER_DOMAIN must be a domain such as dripfunnel-mail.com').optional(),
  // Keys the suppression list's address hashes (db/scoped/emailSuppression.ts): 32 bytes in base64.
  EMAIL_SUPPRESSION_KEY: z
    .string()
    .refine((value) => /^[A-Za-z0-9+/]{43}=$/.test(value), 'EMAIL_SUPPRESSION_KEY must be 32 bytes in base64')
    .optional(),
  // The SNS topic SES publishes bounces and complaints to; only its messages are read (hooks/ses.ts).
  SES_EVENTS_TOPIC_ARN: z.string().regex(/^arn:aws:sns:[a-z0-9-]+:\d{12}:[A-Za-z0-9_-]{1,256}$/, 'SES_EVENTS_TOPIC_ARN must be an SNS topic ARN').optional(),
  // DripFunnel's Shopify app (CATALOG K7), Worker secrets. Absent, Connect Shopify says it isn't set up and the
  // callback route doesn't exist; SHOPIFY_LOCAL=1 (local only) answers with an empty shop instead (docs/setup/local.md).
  SHOPIFY_CLIENT_ID: z.string().regex(/^[0-9a-f]{32}$/, 'SHOPIFY_CLIENT_ID must be the app’s 32-character client id').optional(),
  SHOPIFY_CLIENT_SECRET: z.string().min(1).optional(),
  SHOPIFY_LOCAL: z.literal('1').optional(),
  // The DripFunnel Provisioning GitHub App (THIRD-PARTY-ACCESS.md §2.3): IDs as variables, the PEM a Worker secret.
  // All three or none; without them store repos aren't created and the request waits in the outbox.
  GITHUB_APP_ID: z.string().regex(/^\d+$/, 'GITHUB_APP_ID must be the App’s numeric id').optional(),
  GITHUB_APP_INSTALLATION_ID: z.string().regex(/^\d+$/, 'GITHUB_APP_INSTALLATION_ID must be the numeric installation id').optional(),
  GITHUB_APP_PRIVATE_KEY: z
    .string()
    .transform((value) => value.replaceAll('\\n', '\n').trim())
    .refine((value) => /^-----BEGIN (RSA )?PRIVATE KEY-----\n[\s\S]+\n-----END (RSA )?PRIVATE KEY-----$/.test(value), 'GITHUB_APP_PRIVATE_KEY must be the App’s PEM private key')
    .optional(),
  // The App's webhook secret, a Worker secret (#968): without it a push to a store repo's `main` builds nothing.
  GITHUB_WEBHOOK_SECRET: z.string().min(20, 'GITHUB_WEBHOOK_SECRET must be at least 20 characters').optional(),
  // The R2 storefront upload credential (THIRD-PARTY-ACCESS.md §2.1, §8): all six or none; without them a store build's
  // calls (storefront LIVE-SHOP.md §4 steps 5–9) don't exist. The account id and bucket names are variables.
  R2_STOREFRONT_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, 'R2_STOREFRONT_ACCOUNT_ID must be the 32-character account id').optional(),
  R2_STOREFRONT_ACCESS_KEY_ID: z.string().regex(/^[0-9a-f]{32}$/, 'R2_STOREFRONT_ACCESS_KEY_ID must be the R2 token’s access key id').optional(),
  R2_STOREFRONT_SECRET_ACCESS_KEY: z.string().regex(/^[0-9a-f]{64}$/, 'R2_STOREFRONT_SECRET_ACCESS_KEY must be the R2 token’s secret access key').optional(),
  R2_STOREFRONT_API_TOKEN: z.string().min(20).optional(),
  STOREFRONT_SITES_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'STOREFRONT_SITES_BUCKET must be an R2 bucket name').optional(),
  STOREFRONT_DRAFTS_BUCKET: z.string().regex(/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/, 'STOREFRONT_DRAFTS_BUCKET must be an R2 bucket name').optional(),
  // The organisation store repos are created in (LIVE-SHOP.md §3).
  GITHUB_STORE_ORG: z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/, 'GITHUB_STORE_ORG must be a GitHub organisation name').default('dripfunnel'),
  // Local stand-ins for the last step of email, SMS, push, couriers and DNS (docs/setup/local.md §6.1): the outbox, templates,
  // quotes and checks run as on dev, and the message is printed, the rate made up, or the record answered, on this machine.
  EMAIL_LOCAL: z.literal('1').optional(),
  SMS_LOCAL: z.literal('1').optional(),
  PUSH_LOCAL: z.literal('1').optional(),
  DNS_LOCAL: z.literal('1').optional(),
  COURIERS_LOCAL: z.literal('1').optional(),
  // Store repos in an in-memory GitHub on this machine (docs/setup/local.md §6.1), whatever the GITHUB_APP_* values.
  GITHUB_LOCAL: z.literal('1').optional(),
  // The studio's sandbox on this machine instead of a container (docs/setup/local.md): `pnpm --filter ./apps/sandbox start:local`.
  SANDBOX_LOCAL_URL: z.string().regex(/^http:\/\/(127\.0\.0\.1|localhost):\d{2,5}$/, 'SANDBOX_LOCAL_URL must be http://127.0.0.1:<port>').optional(),
  // The designer's model key on plans that include AI (THIRD-PARTY-ACCESS.md §2.6): a Worker secret standing in for the
  // partner's own key until partner credentials exist (#275). Unset, a request on the plan answers AI_NOT_CONNECTED.
  AI_PROVIDER_KEY: z.string().regex(/^sk-ant-[A-Za-z0-9_-]{20,}$/, 'AI_PROVIDER_KEY must be an Anthropic API key').optional(),
  // Claude and ChatGPT sign-in (THIRD-PARTY-ACCESS §2.6): off unless 1, so it can be switched off without a deploy of code.
  AI_SIGN_IN: z.literal('1').optional(),
  /** 1 lets the studio's AI search and add photos itself, from `AI_PHOTO_SOURCES`; unset leaves it to the merchant's picker. */
  AI_PHOTOS: z.literal('1').optional(),
  /** With AI_PHOTOS, the sources the AI may use, comma separated; unset or empty is `aiPhotoSourcesDefault`. Pixabay and Unsplash only when named: read their terms first. */
  AI_PHOTO_SOURCES: z.string().transform((v) => v.split(',').map((n) => n.trim()).filter(Boolean)).pipe(z.array(z.enum(photoSources))).transform((l) => (l.length ? l : undefined)).optional(),
  // The designer's model on this machine (docs/setup/local.md §6.1): it answers every request with no change.
  AI_LOCAL: z.literal('1').optional(),
  // A sample site's screenshot for the designer (storefront ARCHITECTURE §6.2): Cloudflare Browser Rendering, both or none.
  BROWSER_RENDERING_ACCOUNT_ID: z.string().regex(/^[0-9a-f]{32}$/, 'BROWSER_RENDERING_ACCOUNT_ID must be the 32-character account id').optional(),
  BROWSER_RENDERING_TOKEN: z.string().min(20).optional(),
  /** Pixabay's API key for the studio's stock image picker; unset leaves Pixabay out. */
  PIXABAY_API_KEY: z.string().min(10).optional(),
  /** Pexels' API key for the same picker; unset leaves Pexels out. */
  PEXELS_API_KEY: z.string().min(10).optional(),
  /** Unsplash's Access Key for the same picker (human-only); unset leaves Unsplash out. */
  UNSPLASH_ACCESS_KEY: z.string().min(10).optional(),
  // Studios running at once across the account (storefront AI-STUDIO §7); the rest wait in the queue. Unset: 5,000.
  STUDIO_MAX_RUNNING: z.coerce.number().int().min(1).max(100_000).optional(),
  // The org's Actions jobs at once, which a core rollout's waves are sized to (storefront LIVE-SHOP §10). Unset: 20 (Free).
  GITHUB_ACTIONS_JOBS: z.coerce.number().int().min(1).max(10_000).optional(),
  // Expo's push service (THIRD-PARTY-ACCESS.md §2.13), a Worker secret. Absent, pushes wait in the outbox.
  EXPO_PUSH_TOKEN: z.string().regex(/^[A-Za-z0-9_-]{20,}$/, 'EXPO_PUSH_TOKEN must be an Expo access token').optional(),
  // `0` accepts any email or text code (docs/setup/dev.md).
  CODE_CHECK: z.enum(['1', '0']).optional(),
})

const devHooksHost = 'dev-hooks.actuateminds.com'
export const isLocalhost = (host: string): boolean => /(^|\.)localhost$/.test(host)
const localOnly = ['SHOPIFY_LOCAL', 'EMAIL_LOCAL', 'SMS_LOCAL', 'PUSH_LOCAL', 'DNS_LOCAL', 'COURIERS_LOCAL', 'GITHUB_LOCAL', 'SANDBOX_LOCAL_URL', 'AI_LOCAL'] as const

// The stand-ins skip a provider's checks, so a Worker anywhere but on *.localhost refuses to start with one.
const checkedConfig = configSchema.superRefine((c, ctx) => {
  // The suppression list keys its hashes with it, stand-in or SES (db/scoped/emailSuppression.ts).
  if (c.EMAIL_LOCAL !== undefined && c.EMAIL_SUPPRESSION_KEY === undefined) ctx.addIssue({ code: 'custom', message: 'EMAIL_LOCAL needs EMAIL_SUPPRESSION_KEY', path: ['EMAIL_SUPPRESSION_KEY'] })
  // A publishable key acts in its secret key's mode; one from the other mode would fail every payment.
  const modeOf = (key: string | undefined) => key?.match(/_(test|live)_/)?.[1]
  if (c.STRIPE_PUBLISHABLE_KEY !== undefined && modeOf(c.STRIPE_PUBLISHABLE_KEY) !== modeOf(c.STRIPE_SECRET_KEY)) ctx.addIssue({ code: 'custom', message: 'STRIPE_PUBLISHABLE_KEY must be in STRIPE_SECRET_KEY’s mode', path: ['STRIPE_PUBLISHABLE_KEY'] })
  if ((c.STRIPE_TEST_SECRET_KEY === undefined) !== (c.STRIPE_TEST_PUBLISHABLE_KEY === undefined)) ctx.addIssue({ code: 'custom', message: 'STRIPE_TEST_SECRET_KEY and STRIPE_TEST_PUBLISHABLE_KEY go together', path: ['STRIPE_TEST_SECRET_KEY'] })
  const github = [c.GITHUB_APP_ID, c.GITHUB_APP_INSTALLATION_ID, c.GITHUB_APP_PRIVATE_KEY].filter((v) => v !== undefined).length
  if (github !== 0 && github !== 3) ctx.addIssue({ code: 'custom', message: 'GITHUB_APP_ID, GITHUB_APP_INSTALLATION_ID and GITHUB_APP_PRIVATE_KEY go together', path: ['GITHUB_APP_ID'] })
  const r2 = [c.R2_STOREFRONT_ACCOUNT_ID, c.R2_STOREFRONT_ACCESS_KEY_ID, c.R2_STOREFRONT_SECRET_ACCESS_KEY, c.R2_STOREFRONT_API_TOKEN, c.STOREFRONT_SITES_BUCKET, c.STOREFRONT_DRAFTS_BUCKET].filter((v) => v !== undefined).length
  if (r2 !== 0 && r2 !== 6) ctx.addIssue({ code: 'custom', message: 'The four R2_STOREFRONT_* values and the two STOREFRONT_*_BUCKET names go together', path: ['R2_STOREFRONT_ACCOUNT_ID'] })
  if ((c.BROWSER_RENDERING_ACCOUNT_ID === undefined) !== (c.BROWSER_RENDERING_TOKEN === undefined)) ctx.addIssue({ code: 'custom', message: 'BROWSER_RENDERING_ACCOUNT_ID and BROWSER_RENDERING_TOKEN go together', path: ['BROWSER_RENDERING_ACCOUNT_ID'] })
  const ourHosts = [c.ADMIN_HOST, c.PLATFORM_HOST, c.HOOKS_HOST, c.EDGE_ZONE]
  if (c.SHOP_DOMAIN !== undefined && ourHosts.some((h) => h === c.SHOP_DOMAIN || h.endsWith(`.${c.SHOP_DOMAIN}`) || c.SHOP_DOMAIN?.endsWith(`.${h}`)))
    ctx.addIssue({ code: 'custom', message: 'SHOP_DOMAIN must be apart from the consoles’ hosts and EDGE_ZONE', path: ['SHOP_DOMAIN'] })
  if (isLocalhost(c.HOOKS_HOST)) return
  if (c.SHOP_DOMAIN !== undefined && isLocalhost(c.SHOP_DOMAIN)) ctx.addIssue({ code: 'custom', message: 'SHOP_DOMAIN on localhost is for local development only', path: ['SHOP_DOMAIN'] })
  for (const key of localOnly) {
    if (c[key] !== undefined) ctx.addIssue({ code: 'custom', message: `${key} is for local development only (HOOKS_HOST on localhost)`, path: [key] })
  }
})

export const isDevOrLocal = (config: Pick<Config, 'HOOKS_HOST'>): boolean => config.HOOKS_HOST === devHooksHost || isLocalhost(config.HOOKS_HOST)
export type Config = z.infer<typeof configSchema>

export const parseConfig = (env: Record<string, unknown>): Config => checkedConfig.parse(env)
