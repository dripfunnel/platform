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
})

export type Config = z.infer<typeof configSchema>

export const parseConfig = (env: Record<string, unknown>): Config => configSchema.parse(env)
