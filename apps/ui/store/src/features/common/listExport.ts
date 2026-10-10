import type { ExportJob } from '@dripfunnel/shared/graphql'
import { startExport, useExportJob } from '@dripfunnel/shared/ui'
import { loadCustomerExport } from '../../api/customers'
import { loadCatalogExport } from '../../api/imports'
import { loadOrderExport } from '../../api/orders'
import { loadReportExport } from '../../api/reports'

// The shell follows one export at a time, whichever list started it (shared exportJob); each kind is read back by its
// own query, and each list shows only its own kind's job.

export type ExportKind = 'catalog' | 'orders' | 'customers' | 'reports'

const readers: Record<ExportKind, (id: string) => Promise<ExportJob | null>> = { catalog: loadCatalogExport, orders: loadOrderExport, customers: loadCustomerExport, reports: loadReportExport }
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

/**
 * The shell's watcher reads each job back by its own kind's query. A job whose kind this tab doesn't know is asked of
 * each kind in turn, and the one that answers is remembered.
 */
export const loadAnyExport = async (id: string): Promise<ExportJob | null> => {
  const known = kinds.get(id)
  if (known) return readers[known](id)
  for (const kind of Object.keys(readers) as ExportKind[]) {
    const job = await readers[kind](id)
    if (job) {
      kinds.set(id, kind)
      return job
    }
  }
  return null
}

/** The running export, when it is this list's kind. */
export const useListExport = (kind: ExportKind): ExportJob | null => {
  const job = useExportJob()
  return job && kinds.get(job.id) === kind ? job : null
}
