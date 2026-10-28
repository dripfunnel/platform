import { crashReportingIsSetUp } from './config'
import { loadCrashlytics } from './sdk'
import { scrubbed } from './scrub'

// Crash reports (shop/ARCHITECTURE.md §2): off unless the build has its store's Firebase files, and what they hold is only a code or a class, the frames and an opaque customer id.

let started = false

/** Switches collection on and puts the scrubbing in front of Crashlytics' own handler, which records what it is given: an uncaught error is cleaned before it is. */
export const startReporting = (): void => {
  if (started || !crashReportingIsSetUp()) return
  started = true
  const { getCrashlytics, setCrashlyticsCollectionEnabled } = loadCrashlytics()
  const crashlytics = getCrashlytics()
  void setCrashlyticsCollectionEnabled(crashlytics, true)
  const theirs = ErrorUtils.getGlobalHandler()
  ErrorUtils.setGlobalHandler((error, fatal) => theirs(scrubbed(error), fatal))
}

/** An error the app caught and could not recover from. */
export const reportError = (error: unknown): void => {
  if (!crashReportingIsSetUp()) return
  const { getCrashlytics, recordError } = loadCrashlytics()
  recordError(getCrashlytics(), scrubbed(error))
}

/** The signed-in customer's opaque id, or none for a guest. No name, email or phone, ever. */
export const setReportingUser = (id: string | null): void => {
  if (!crashReportingIsSetUp()) return
  const { getCrashlytics, setUserId } = loadCrashlytics()
  void setUserId(getCrashlytics(), id ?? '')
}
