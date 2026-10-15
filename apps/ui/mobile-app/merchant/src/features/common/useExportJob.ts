import { useCallback, useEffect, useRef, useState } from 'react'
import type { ExportJob } from '../../api/exportJob'

// An export is a job the API prepares (store FIRST-RELEASE §13): ask for it, read it back until it is ready, failed or too large.
// The wait is bounded, so a job that never finishes reads as failed rather than polling for ever.
const pollMs = 1500
const maxPolls = 80

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

type Options = {
  /** Asks for the job; answers its id. */
  request: () => Promise<string>
  read: (id: string) => Promise<ExportJob | null>
  /** Called once, with a job that came out ready. */
  onReady: (job: ExportJob) => void
}

const preparing = (id: string): ExportJob => ({ id, state: 'preparing', entries: null, csv: null, expiresAt: null, truncated: false })

export function useExportJob({ request, read, onReady }: Options) {
  const [job, setJob] = useState<ExportJob | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  const run = useRef(0)
  const latest = useRef({ request, read, onReady })
  latest.current = { request, read, onReady }

  useEffect(
    () => () => {
      run.current += 1
    },
    [],
  )

  const start = useCallback(async () => {
    const mine = ++run.current
    const current = () => run.current === mine
    setError(null)
    setJob(null)
    setBusy(true)
    try {
      const id = await latest.current.request()
      if (!current()) return
      let next = preparing(id)
      setJob(next)
      for (let polls = 0; polls < maxPolls && next.state === 'preparing'; polls += 1) {
        if (polls > 0) await wait(pollMs)
        if (!current()) return
        next = (await latest.current.read(id)) ?? { ...preparing(id), state: 'failed' }
        if (!current()) return
        setJob(next)
      }
      if (next.state === 'preparing') setJob({ ...next, state: 'failed' })
      else if (next.state === 'ready') latest.current.onReady(next)
    } catch (failure) {
      if (current()) setError(failure)
    } finally {
      if (current()) setBusy(false)
    }
  }, [])

  return { job, error, busy, start }
}
