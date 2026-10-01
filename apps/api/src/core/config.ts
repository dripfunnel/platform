import { z } from 'zod'

const configSchema = z.object({
  ADMIN_HOST: z.string().min(1),
  PLATFORM_HOST: z.string().min(1),
  HOOKS_HOST: z.string().min(1),
  HYPERDRIVE: z.object({ connectionString: z.string().min(1) }).optional(),
  // Worker secrets, never VITE_* (THIRD-PARTY-ACCESS.md §2.5). Absent until the app
  // registration exists, and then every sign-in is refused as `provider_unconfigured`.
  ENTRA_TENANT_ID: z.string().min(1).optional(),
  ENTRA_CLIENT_ID: z.string().min(1).optional(),
  ENTRA_CLIENT_SECRET: z.string().min(1).optional(),
})

export type Config = z.infer<typeof configSchema>

export const parseConfig = (env: Record<string, unknown>): Config => configSchema.parse(env)
