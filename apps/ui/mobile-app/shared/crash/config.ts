import Constants from 'expo-constants'
import { z } from 'zod'

// Set by each app's app.config.ts for a build with its Firebase files (shop: docs/mobile-app/README.md §3; merchant: CONFIGURATION.md §3): without them the app reports nothing and runs as it did.
const extra = z.object({ crashReporting: z.literal(true) })

/** Whether this build reports crashes: a build with its Firebase files, never a development build, whose crashes are the developer's to read. */
export const crashReportingIsSetUp = (): boolean => !__DEV__ && extra.safeParse(Constants.expoConfig?.extra).success
