import { loadActivity, type ActivityFilter, type ActivityPage } from '../../api/activity'
import { sampleRead } from './activitySample'

// Store activity's states under ?state= (ui/README.md §6): loading, error, list (the sample), readOnly (a store past due:
// the log and its export still work) and denied (anyone without `activity.read`).
export const activityStates = ['loading', 'error', 'list', 'readOnly', 'denied'] as const

type Read = (filter: ActivityFilter, after: string | null) => Promise<ActivityPage>

const never: Read = () => new Promise<ActivityPage>(() => undefined)
const fails: Read = () => Promise.reject(new Error('forced error'))

/** The log's read for a forced state, or the API's. */
export const activityRead = (forced: (typeof activityStates)[number] | null): Read => (forced === 'loading' ? never : forced === 'error' ? fails : forced ? sampleRead : loadActivity)
