import { isApiError } from '@dripfunnel/shared/graphql'
import { useCallback, useEffect, useState } from 'react'
import type { PublishRun } from '../../api/studio'
import { publishPollMs, publishProgress, publishReadTries } from './studioRules'
import type { StorefrontApi } from './storefrontApi'

export interface PublishRunHandlers {
  /** An answer while the publish is still running (publishProgress holds). */
  onProgress?: (answer: PublishRun) => void
  /** The publish ended, or null when there is no such publish; reading stops. */
  onEnd: (answer: PublishRun | null) => void
  /** Every failed read, before deciding whether to ask again. */
  onReadError?: (e: unknown) => void
  /** A value whose change starts the reading over (the studio opening again). */
  restart?: unknown
}

/** Reads the publish followed every publishPollMs until it ends; only the newest answer for the run followed lands. */
export const usePublishRun = (api: Pick<StorefrontApi, 'loadPublishRun'>, run: string | null, { onProgress, onEnd, onReadError, restart }: PublishRunHandlers) => {
  const [lost, setLost] = useState(false)
  const [checks, setChecks] = useState(0)

  useEffect(() => {
    if (!run) return
    let current = true
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    setLost(false)
    const read = () =>
      api.loadPublishRun(run).then(
        (answer) => {
          if (!current) return
          failures = 0
          if (!answer || !publishProgress(answer.step)) return onEnd(answer)
          onProgress?.(answer)
          timer = setTimeout(() => void read(), publishPollMs)
        },
        (e: unknown) => {
          if (!current) return
          failures += 1
          onReadError?.(e)
          // A refused read, or one that keeps failing, stops asking but keeps the publish followed: it may still be running.
          if (isApiError(e, 'SESSION_ENDED') || isApiError(e, 'FORBIDDEN') || failures >= publishReadTries) return setLost(true)
          timer = setTimeout(() => void read(), publishPollMs)
        },
      )
    void read()
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [api, run, onProgress, onEnd, onReadError, restart, checks])

  const checkAgain = useCallback(() => setChecks((n) => n + 1), [])
  return { lost, checkAgain }
}
