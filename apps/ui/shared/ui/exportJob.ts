import { useSyncExternalStore } from 'react'
import type { ExportJob } from '../graphql/exportJob'

// Held outside any screen, so an export keeps going and is announced after the person leaves the list (decided on #44).
let current: ExportJob | null = null
const listeners = new Set<() => void>()

export const exportJob = {
  get: () => current,
  set: (job: ExportJob | null) => {
    current = job
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

export const useExportJob = () => useSyncExternalStore(exportJob.subscribe, exportJob.get, exportJob.get)

// Starts an export: the API's job goes into the store, and a start the API did not answer ends as failed.
export const startExport = (started: Promise<ExportJob>) =>
  started.then(exportJob.set).catch(() => exportJob.set({ id: 'failed', state: 'failed', entries: null, url: null, expiresAt: null }))

export type ExportCheck = { kind: 'again' } | { kind: 'update'; job: ExportJob; announce: boolean }

// One status check's outcome: an unchanged job is checked again, an unanswered one has failed.
export const exportCheck = (job: ExportJob, answer: ExportJob | null | 'unreachable'): ExportCheck => {
  if (answer !== 'unreachable' && answer?.state === job.state) return { kind: 'again' }
  if (answer === null || answer === 'unreachable') return { kind: 'update', job: { ...job, state: 'failed', url: null, expiresAt: null }, announce: false }
  return { kind: 'update', job: { ...answer }, announce: answer.state === 'ready' }
}
