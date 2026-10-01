import { useSyncExternalStore } from 'react'
import type { ActivityExport } from '../../api/activity'

// Held outside any screen, so an export keeps going and is announced after staff leave the Activity log (decided on #44).
let current: ActivityExport | null = null
const listeners = new Set<() => void>()

export const exportJob = {
  get: () => current,
  set: (job: ActivityExport | null) => {
    current = job
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

export const useExportJob = () => useSyncExternalStore(exportJob.subscribe, exportJob.get, exportJob.get)

export type ExportCheck = { kind: 'again' } | { kind: 'update'; job: ActivityExport; announce: boolean }

// One status check's outcome: an unchanged job is checked again, an unanswered one has failed.
export const exportCheck = (job: ActivityExport, answer: ActivityExport | null | 'unreachable'): ExportCheck => {
  if (answer !== 'unreachable' && answer?.state === job.state) return { kind: 'again' }
  if (answer === null || answer === 'unreachable') return { kind: 'update', job: { ...job, state: 'failed', url: null, expiresAt: null }, announce: false }
  return { kind: 'update', job: { ...answer }, announce: answer.state === 'ready' }
}
