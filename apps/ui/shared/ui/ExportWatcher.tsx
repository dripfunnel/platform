import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExportJob } from '../graphql/exportJob'
import { exportCheck, exportJob, useExportJob } from './exportJob'
import { Toast } from './Toast'

const pollMs = 1000

export interface ExportWatcherProps {
  // The app's status query for an export, by id.
  load: (id: string) => Promise<ExportJob | null>
  // Said when the export becomes ready, wherever the person is.
  toast: string
}

// Mounted in a shell: follows a running export on any screen, says when it's ready, and notices when its link expires.
export const ExportWatcher = ({ load, toast: ready }: ExportWatcherProps) => {
  const job = useExportJob()
  // Held in refs, so an inline `load` never restarts the poll.
  const loadRef = useRef(load)
  loadRef.current = load
  const readyRef = useRef(ready)
  readyRef.current = ready
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
      if (outcome.announce) setToast(readyRef.current)
      exportJob.set(outcome.job)
    }
    const check = () => void loadRef.current(current.id).then(settle, () => settle('unreachable'))
    const untilExpiry = expiresAt ? Date.parse(expiresAt) - Date.now() : 0
    timer = setTimeout(check, state === 'preparing' ? pollMs : Math.max(pollMs, untilExpiry))
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [id, state, expiresAt])

  return <Toast message={toast} onDone={clearToast} />
}
