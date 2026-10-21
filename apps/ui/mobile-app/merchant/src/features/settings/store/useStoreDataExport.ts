import { useCallback, useState } from 'react'
import type { ExportJob } from '../../../api/exportJob'
import { loadStoreDataExport, requestStoreDataExport, type StoreDataPart } from '../../../api/settingsStore'
import type { ApiClient } from '../../../graphql'
import { useExportJob } from '../../common/useExportJob'

// "Download my data first": `exportStoreData`'s three parts, read back until none is still queued. The parts settle on their own, so
// the shared job hook polls a summary of them and each part's own state is kept here for the sheet to draw.
const summaryOf = (id: string, parts: readonly StoreDataPart[]): ExportJob | null =>
  parts.length === 0 ? null : { id, state: parts.some((part) => part.job.state === 'preparing') ? 'preparing' : 'ready', entries: null, csv: null, expiresAt: null, truncated: false }

export function useStoreDataExport(client: ApiClient) {
  const [parts, setParts] = useState<StoreDataPart[] | null>(null)
  const exported = useExportJob({
    request: () => requestStoreDataExport(client),
    read: async (id) => {
      const read = await loadStoreDataExport(client, id)
      setParts(read)
      return summaryOf(id, read)
    },
    onReady: () => undefined,
  })
  const { start: begin } = exported
  const start = useCallback(() => {
    setParts(null)
    return begin()
  }, [begin])

  return { parts, state: exported.job?.state ?? null, error: exported.error, busy: exported.busy, start }
}
