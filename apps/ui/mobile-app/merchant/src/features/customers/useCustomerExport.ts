import { useCallback } from 'react'
import { loadCustomerExport, requestCustomerExport, type CustomerQuery } from '../../api/customers'
import type { ExportJob } from '../../api/exportJob'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { shareCsv } from '../common/shareCsv'
import { useExportJob } from '../common/useExportJob'
import { useFeedback } from '../shell/Feedback'

const fileName = (): string => t('customers.export.file', { date: new Date().toISOString().slice(0, 10) })

// The customers export as the list is filtered and searched: a job, shared through the system sheet once it is ready (decided on #503: no file dependency).
export function useCustomerExport(client: ApiClient, query: CustomerQuery) {
  const feedback = useFeedback()

  const share = useCallback(
    async (job: ExportJob) => {
      if (job.csv === null) return
      try {
        await shareCsv(fileName(), job.csv)
      } catch {
        feedback.toast({ message: t('customers.export.shareFailed') })
      }
    },
    [feedback],
  )

  const exported = useExportJob({
    request: () => requestCustomerExport(client, query),
    read: (id) => loadCustomerExport(client, id),
    onReady: (job) => void share(job),
  })

  return { ...exported, share }
}
