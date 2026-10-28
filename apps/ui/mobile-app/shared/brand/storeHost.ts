import Constants from 'expo-constants'
import { z } from 'zod'

// The build values that reach the running app (docs/mobile-app/README.md §3); app.config.ts has validated STORE_HOST
// already, and the app checks again so a bad build stops at start, not at the first call.
const extra = z.object({ STORE_HOST: z.string().min(1) })

export const storeHost = (): string => {
  const parsed = extra.safeParse(Constants.expoConfig?.extra)
  if (!parsed.success) throw new Error('The build has no STORE_HOST (docs/mobile-app/README.md §3).')
  return parsed.data.STORE_HOST
}
