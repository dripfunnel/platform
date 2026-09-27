import { z } from 'zod'

const configSchema = z.object({
  PLATFORM_HOST: z.string().min(1),
  HOOKS_HOST: z.string().min(1),
})

export type Config = z.infer<typeof configSchema>

export const parseConfig = (env: Record<string, unknown>): Config => configSchema.parse(env)
