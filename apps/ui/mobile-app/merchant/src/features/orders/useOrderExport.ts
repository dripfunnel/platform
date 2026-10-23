import { useCallback } from 'react'
import type { ExportJob } from '../../api/exportJob'
import { loadOrderExport, requestOrderExport, type OrderQuery } from '../../api/orders'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { shareCsv } from '../common/shareCsv'
import { useExportJob } from '../common/useExportJob'
import { useFeedback } from '../shell/Feedback'

// The orders export as the list is filtered and searched: asked as a job, read back, and the file handed to the share sheet when it is ready.
export function useOrderExport(client: ApiClient, query: OrderQuery) {
  const feedback = useFeedback()

  const share = useCallback(
    async (job: ExportJob) => {
      if (job.csv === null) return
      try {
        await shareCsv(t('orders.export.title'), job.csv)
      } catch {
        feedback.toast({ message: t('orders.export.shareFailed') })
      }
    },
    [feedback],
  )

  const exported = useExportJob({
    request: () => requestOrderExport(client, query),
    read: (id) => loadOrderExport(client, id),
    onReady: (job) => void share(job),
  })

  return { ...exported, share }
}
