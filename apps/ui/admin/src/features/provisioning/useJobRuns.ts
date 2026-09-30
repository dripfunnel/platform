import { useRouter, useRouterState } from '@tanstack/react-router'
import { useCallback, useEffect, useRef, useState } from 'react'
import { loadJobProgress, retryJob, undoJob, type JobAction, type JobProgress } from '../../api/provisioning'
import { paces, type Pace } from '../../api/provisioningSample'
import { fill, messages } from '../../messages'
import { harnessEnabled } from '../common/useScreenState'
import type { JobTarget } from './jobDialog'

const words = messages.provisioning

// How often a screen asks again while a job it shows is still running. The Workflow reports on
// the next query, so a button only looks finished once the job says it is.
const pollMs = 1000

export interface JobOnScreen {
  id: string
  state: JobProgress['state'] | 'done'
}

export type JobOutcome = 'retried' | 'failedAgain' | 'undone'

const isActive = (job: JobOnScreen) => job.state === 'running' || job.state === 'cleaning'

// ?pace=fast|normal|slow sets how long the sample Workflow takes over each step; it goes with
// the sample.
const usePace = (): Pace => {
  const searchStr = useRouterState({ select: (state) => state.location.searchStr })
  const pace = new URLSearchParams(searchStr).get('pace')
  return harnessEnabled ? (paces.find((candidate) => candidate === pace) ?? 'normal') : 'normal'
}

interface Watched {
  action: JobAction
  name: string
}

// Starts a Retry or an Undo and follows the job until it reports back, then says how it ended.
// A started job is followed by its own progress, not by whether the page still lists it: a
// filtered or paged list can drop a job that is still running.
export const useJobRuns = (jobs: readonly JobOnScreen[], onOutcome: (outcome: JobOutcome, message: string) => void) => {
  const router = useRouter()
  const pace = usePace()
  const watched = useRef(new Map<string, Watched>())
  const [watching, setWatching] = useState(0)

  useEffect(() => {
    if (watching === 0) return
    let cancelled = false
    const check = async () => {
      for (const [id, run] of [...watched.current]) {
        const job = await loadJobProgress(id)
        if (cancelled) return
        if (job && isActive(job)) continue
        watched.current.delete(id)
        if (!job) onOutcome(run.action === 'undo' ? 'undone' : 'retried', fill(run.action === 'undo' ? words.toasts.undone : words.toasts.retried, { name: run.name }))
        else if (job.state === 'failed' && run.action === 'retry') onOutcome('failedAgain', fill(words.toasts.failedAgain, { name: run.name, step: words.steps[job.step] }))
      }
      setWatching(watched.current.size)
    }
    void check().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [jobs, watching, onOutcome])

  const active = watching > 0 || jobs.some(isActive)
  useEffect(() => {
    if (!active) return
    const timer = setTimeout(() => void router.invalidate(), pollMs)
    return () => clearTimeout(timer)
  }, [active, jobs, router])

  // Resolves with what to tell staff once the Workflow has started; the outcome comes later.
  const run = useCallback(
    async (action: JobAction, jobId: string, target: JobTarget, reason: string | null) => {
      await (action === 'undo' ? undoJob(jobId, reason ?? '', pace) : retryJob(jobId, pace))
      watched.current.set(jobId, { action, name: target.name })
      setWatching(watched.current.size)
      await router.invalidate()
      return fill(action === 'undo' ? words.toasts.undo : words.toasts.retry, { name: target.name, step: words.steps[target.step] })
    },
    [pace, router],
  )

  return { run }
}
