import Constants from 'expo-constants'
import { z } from 'zod'

// The store's own EAS project (docs/mobile-app/README.md §3): without it the app never asks for notification permission or registers a phone.
const extra = z.object({ eas: z.object({ projectId: z.string().min(1) }) })

export const pushProjectId = (): string | null => {
  const parsed = extra.safeParse(Constants.expoConfig?.extra)
  return parsed.success ? parsed.data.eas.projectId : null
}
