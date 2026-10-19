import { useCallback, useRef, useState } from 'react'
import type { ExportJob } from '../../api/exportJob'
import { loadActivityExport, requestActivityExport, type ActivityFilter } from '../../api/activity'
import type { ApiClient } from '../../graphql'
import { t } from '../../messages'
import { shareCsv } from '../common/shareCsv'
import { useExportJob } from '../common/useExportJob'
import { useFeedback } from '../shell/Feedback'

// The log as it is filtered, asked as a job (`activity.export`, the Owner's alone), read back until ready and handed to the share sheet.
// `begin` throws the refusal of the ask itself, so the caller says it where the person asked.
export function useActivityExport(client: ApiClient) {
  const feedback = useFeedback()
  const asked = useRef<string | null>(null)
  const [asking, setAsking] = useState(false)

  const share = useCallback(
    async (job: ExportJob) => {
      if (job.csv === null) return
      try {
        await shareCsv(t('activity.export.title'), job.csv)
      } catch {
        feedback.toast({ message: t('activity.export.shareFailed') })
      }
    },
    [feedback],
  )

  const exported = useExportJob({
    request: () => (asked.current !== null ? Promise.resolve(asked.current) : Promise.reject(new Error('No export was asked for.'))),
    read: (id) => loadActivityExport(client, id),
    onReady: (job) => void share(job),
  })

  const begin = async (filter: ActivityFilter): Promise<void> => {
    setAsking(true)
    try {
      asked.current = await requestActivityExport(client, filter)
    } finally {
      setAsking(false)
    }
    void exported.start()
  }

  return { job: exported.job, error: exported.error, busy: asking || exported.busy, begin, share }
}
