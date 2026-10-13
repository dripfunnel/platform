import Constants from 'expo-constants'
import { z } from 'zod'

// The only build value that reaches the running app (CONFIGURATION.md §1); app.config.ts has validated it
// already, and the app checks again so a bad build stops at start, not at the first call.
const extra = z.object({ PARTNER_DOMAIN: z.string().min(1) })

export const partnerDomain = (): string => {
  const parsed = extra.safeParse(Constants.expoConfig?.extra)
  if (!parsed.success) throw new Error('The build has no PARTNER_DOMAIN (CONFIGURATION.md §2).')
  return parsed.data.PARTNER_DOMAIN
}
