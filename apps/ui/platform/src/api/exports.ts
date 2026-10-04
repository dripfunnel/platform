import type { ExportJob } from '@dripfunnel/shared/graphql'
import { loadActivityExport } from './activity'
import { loadReportExport } from './reports'
import { loadStoresExport } from './stores'

// The console runs one export at a time (shared/ui exportJob); each screen shows only its own kind.
export type ExportKind = 'stores' | 'activity' | 'report'

const kinds = new Map<string, ExportKind>()

// The job a start gives, tagged with its kind; a start that fails is the shared store's 'failed'
// job (shared/ui exportJob), tagged too, so its own screen shows the failure.
// What the job is of, within its kind: a report's tab, so each tab shows only its own export.
const subjects = new Map<string, string>()

export const startedExport = (kind: ExportKind, started: Promise<ExportJob>, subject?: string): Promise<ExportJob> =>
  started.then(
    (job) => {
      kinds.set(job.id, kind)
      if (subject) subjects.set(job.id, subject)
      return job
    },
    (error: unknown) => {
      kinds.set('failed', kind)
      if (subject) subjects.set('failed', subject)
      throw error
    },
  )

export const exportSubjectOf = (job: ExportJob | null): string | null => (job ? (subjects.get(job.id) ?? null) : null)

export const exportKindById = (id: string): ExportKind | null => kinds.get(id) ?? null

export const exportKindOf = (job: ExportJob | null): ExportKind | null => (job ? exportKindById(job.id) : null)

// The shell's watcher asks the status query of the export's own kind.
const loaders: Record<ExportKind, (id: string) => Promise<ExportJob | null>> = { stores: loadStoresExport, activity: loadActivityExport, report: loadReportExport }

export const loadExport = (id: string): Promise<ExportJob | null> => loaders[kinds.get(id) ?? 'stores'](id)
