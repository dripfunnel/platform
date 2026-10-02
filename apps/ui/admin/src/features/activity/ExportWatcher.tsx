import { useCallback, useEffect, useState } from 'react'
import { loadActivityExport } from '../../api/activity'
import { messages } from '../../messages'
import { Toast } from '@dripfunnel/shared/ui'
import { exportCheck, exportJob, useExportJob } from './exportJob'

const pollMs = 1000

// Mounted in the shell: follows a running export on any screen, says when it's ready, and notices when its link expires.
export const ExportWatcher = () => {
  const job = useExportJob()
  const [toast, setToast] = useState<string | null>(null)
  const clearToast = useCallback(() => setToast(null), [])
  const id = job?.id
  const state = job?.state
  const expiresAt = job?.expiresAt

  useEffect(() => {
    const current = exportJob.get()
    if (!current || current.id !== id || (state !== 'preparing' && state !== 'ready')) return
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    const settle = (answer: Parameters<typeof exportCheck>[1]) => {
      if (!live || exportJob.get()?.id !== current.id) return
      const outcome = exportCheck(current, answer)
      if (outcome.kind === 'again') return void (timer = setTimeout(check, pollMs))
      if (outcome.announce) setToast(messages.activity.export.toast)
      exportJob.set(outcome.job)
    }
    const check = () => void loadActivityExport(current.id).then(settle, () => settle('unreachable'))
    const untilExpiry = expiresAt ? Date.parse(expiresAt) - Date.now() : 0
    timer = setTimeout(check, state === 'preparing' ? pollMs : Math.max(pollMs, untilExpiry))
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [id, state, expiresAt])

  return <Toast message={toast} onDone={clearToast} />
}
