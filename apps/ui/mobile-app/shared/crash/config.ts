import Constants from 'expo-constants'
import { z } from 'zod'

// Set by app.config.ts for a store with both Firebase files (docs/mobile-app/README.md §3): without them the app reports nothing and runs as it did.
const extra = z.object({ crashReporting: z.literal(true) })

/** Whether this build reports crashes: a store build with its Firebase files, never a development build, whose crashes are the developer's to read. */
export const crashReportingIsSetUp = (): boolean => !__DEV__ && extra.safeParse(Constants.expoConfig?.extra).success
