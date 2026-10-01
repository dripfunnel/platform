import type { ActivityExport } from '../../api/activity'

// States (?state=): loading, empty, error, denied (Support: export disabled with its reason), expired and tooLarge (export ends).
export const activityStates = ['loading', 'empty', 'error', 'denied', 'expired', 'tooLarge'] as const
export type ActivityScreenState = (typeof activityStates)[number]

export const forcedExport = (state: ActivityScreenState | null): ActivityExport | null =>
  state === 'expired' || state === 'tooLarge' ? { id: 'x-harness', state, entries: null, url: null, expiresAt: null } : null
