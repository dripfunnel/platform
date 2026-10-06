import { z } from 'zod'

const configSchema = z.object({
  ADMIN_HOST: z.string().min(1),
  PLATFORM_HOST: z.string().min(1),
  HOOKS_HOST: z.string().min(1),
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
  // Local stand-ins for the last step of email, SMS and DNS (docs/setup/local.md §6.1): the outbox, templates and checks
  // run as on dev, and the message is printed, or the record answered, on this machine instead.
  EMAIL_LOCAL: z.literal('1').optional(),
  SMS_LOCAL: z.literal('1').optional(),
  DNS_LOCAL: z.literal('1').optional(),
})

const localOnly = ['SHOPIFY_LOCAL', 'EMAIL_LOCAL', 'SMS_LOCAL', 'DNS_LOCAL'] as const

// The stand-ins skip a provider's checks, so a Worker anywhere but on *.localhost refuses to start with one.
const checkedConfig = configSchema.superRefine((c, ctx) => {
  // The suppression list keys its hashes with it, stand-in or SES (db/scoped/emailSuppression.ts).
  if (c.EMAIL_LOCAL !== undefined && c.EMAIL_SUPPRESSION_KEY === undefined) ctx.addIssue({ code: 'custom', message: 'EMAIL_LOCAL needs EMAIL_SUPPRESSION_KEY', path: ['EMAIL_SUPPRESSION_KEY'] })
  if (/(^|\.)localhost$/.test(c.HOOKS_HOST)) return
  for (const key of localOnly) {
    if (c[key] !== undefined) ctx.addIssue({ code: 'custom', message: `${key} is for local development only (HOOKS_HOST on localhost)`, path: [key] })
  }
})

export type Config = z.infer<typeof configSchema>

export const parseConfig = (env: Record<string, unknown>): Config => checkedConfig.parse(env)
