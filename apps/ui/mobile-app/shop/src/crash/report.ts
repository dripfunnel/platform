import { crashReportingIsSetUp } from './config'
import { loadCrashlytics, loadRejectionTracking } from './sdk'
import { scrubbed } from './scrub'

// Crash reports (shop/ARCHITECTURE.md §2): off unless the build has its store's Firebase files, and what they hold is only a code or a class, the frames and an opaque customer id.

let started = false

/**
 * Switches collection on and puts the scrubbing in front of everything Crashlytics records on its own: an uncaught error is cleaned before its handler sees it,
 * and its unhandled-rejection handler, which records an error's raw message, is replaced by one that records the scrubbed error.
 */
export const startReporting = (): void => {
  if (started || !crashReportingIsSetUp()) return
  started = true
  const { getCrashlytics, setCrashlyticsCollectionEnabled } = loadCrashlytics()
  const crashlytics = getCrashlytics()
  void setCrashlyticsCollectionEnabled(crashlytics, true)
  const theirs = ErrorUtils.getGlobalHandler()
  ErrorUtils.setGlobalHandler((error, fatal) => theirs(scrubbed(error), fatal))
  // After getCrashlytics(), which is when the library enables the tracker: enabling it again replaces the library's handler.
  loadRejectionTracking().enable({ allRejections: true, onUnhandled: (_id, error) => reportError(error) })
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
