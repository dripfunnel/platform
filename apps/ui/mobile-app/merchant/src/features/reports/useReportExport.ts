import { useCallback, useRef, useState } from 'react'
import type { ExportJob } from '../../api/exportJob'
import { loadReportExport, requestReportExport, type CustomReport, type ReportDays, type ReportPanel } from '../../api/reports'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { t } from '../../messages'
import { shareCsv } from '../common/shareCsv'
import { useExportJob } from '../common/useExportJob'
import { useFeedback } from '../shell/Feedback'

// A panel's file, or the builder's, over the range and currency on screen: asked as a job, read back, and handed to the share sheet when ready.
// `begin` throws the refusal of the ask itself, so the caller says it where the person asked (the page, or the builder's sheet).
export function useReportExport(client: ApiClient) {
  const feedback = useFeedback()
  const asked = useRef<string | null>(null)
  const [asking, setAsking] = useState(false)

  const share = useCallback(
    async (job: ExportJob) => {
      if (job.csv === null) return
      try {
        await shareCsv(t('reports.export.title'), job.csv)
      } catch {
        feedback.toast({ message: t('reports.export.shareFailed') })
      }
    },
    [feedback],
  )

  const exported = useExportJob({
    request: () => (asked.current !== null ? Promise.resolve(asked.current) : Promise.reject(new Error('No report was asked for.'))),
    read: (id) => loadReportExport(client, id),
    onReady: (job) => void share(job),
  })

  const begin = async (panel: ReportPanel, days: ReportDays, currency: string, custom: CustomReport | null): Promise<void> => {
    setAsking(true)
    try {
      asked.current = await requestReportExport(client, panel, days, currency, custom)
    } finally {
      setAsking(false)
    }
    void exported.start()
  }

  return { job: exported.job, error: exported.error, busy: asking || exported.busy, begin, share }
}
