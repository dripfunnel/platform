import type { ExportJob } from '@dripfunnel/shared/graphql'
import { loadActivityExport } from './activity'
import { loadStoresExport } from './stores'

// The console runs one export at a time (shared/ui exportJob); each screen shows only its own kind.
export type ExportKind = 'stores' | 'activity'

const kinds = new Map<string, ExportKind>()

// The job a start gives, tagged with its kind; a start that fails is the shared store's 'failed'
// job (shared/ui exportJob), tagged too, so its own screen shows the failure.
export const startedExport = (kind: ExportKind, started: Promise<ExportJob>): Promise<ExportJob> =>
  started.then(
    (job) => {
      kinds.set(job.id, kind)
      return job
    },
    (error: unknown) => {
      kinds.set('failed', kind)
      throw error
    },
  )

export const exportKindById = (id: string): ExportKind | null => kinds.get(id) ?? null

export const exportKindOf = (job: ExportJob | null): ExportKind | null => (job ? exportKindById(job.id) : null)

// The shell's watcher asks the status query of the export's own kind.
export const loadExport = (id: string): Promise<ExportJob | null> => (kinds.get(id) === 'activity' ? loadActivityExport(id) : loadStoresExport(id))
