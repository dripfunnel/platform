import { useSyncExternalStore } from 'react'
import type { CatalogImport } from '../../api/imports'

// The caller's import while it runs, held outside any screen: the run carries on after the person leaves
// Import & export, and the shell's banner and its "finished" toast follow it (FIRST-RELEASE §13).
let current: CatalogImport | null = null
const listeners = new Set<() => void>()

export const importRun = {
  get: () => current,
  set: (run: CatalogImport | null) => {
    current = run
    for (const listener of listeners) listener()
  },
  subscribe: (listener: () => void) => {
    listeners.add(listener)
    return () => void listeners.delete(listener)
  },
}

export const useImportRun = () => useSyncExternalStore(importRun.subscribe, importRun.get, importRun.get)

/** Still being worked through: the products done, or photos still coming in for them. */
export const isRunning = (run: CatalogImport | null): run is CatalogImport & { state: 'running' } => run !== null && run.state === 'running'
