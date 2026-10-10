import type { ExportJob } from '@dripfunnel/shared/graphql'
import { startExport, useExportJob } from '@dripfunnel/shared/ui'
import { loadCatalogExport } from '../../api/imports'
import { loadOrderExport } from '../../api/orders'

// The shell follows one export at a time, whichever list started it (shared exportJob); each kind is read back by its
// own query, and each list shows only its own kind's job.

export type ExportKind = 'catalog' | 'orders'

const readers: Record<ExportKind, (id: string) => Promise<ExportJob | null>> = { catalog: loadCatalogExport, orders: loadOrderExport }
const kinds = new Map<string, ExportKind>()

export const startListExport = (kind: ExportKind, started: Promise<ExportJob>) =>
  startExport(
    started.then(
      (job) => {
        kinds.set(job.id, kind)
        return job
      },
      (error: unknown) => {
        // startExport answers a start that failed with a job of this id.
        kinds.set('failed', kind)
        throw error
      },
    ),
  )

/** The shell's watcher reads each job back by its own kind's query. */
export const loadAnyExport = (id: string): Promise<ExportJob | null> => readers[kinds.get(id) ?? 'catalog'](id)

/** The running export, when it is this list's kind. */
export const useListExport = (kind: ExportKind): ExportJob | null => {
  const job = useExportJob()
  return job && (kinds.get(job.id) ?? 'catalog') === kind ? job : null
}
