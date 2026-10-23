import { useCallback, useEffect, useRef, useState } from 'react'
import { loadPublishRun, type PublishRun, type PublishStep } from '../../api/storefront'
import { isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'

// How often a running publish is read again, and how many reads may fail in a row before the screen stops asking (the web portal's own numbers).
export const publishPollMs = 2000
export const publishReadTries = 5

export type Running = Extract<PublishStep, 'queued' | 'checking' | 'going_live'>
const running = (step: PublishStep): step is Running => step === 'queued' || step === 'checking' || step === 'going_live'

export type Publishing =
  | { phase: 'idle' }
  | { phase: 'running'; step: Running }
  | { phase: 'failed'; run: PublishRun | null }
  | { phase: 'rolledBack' }
  | { phase: 'lost' }

type Handlers = { onLive: (version: number | null) => void }

/** Follows one publish by its id until it ends. The publish goes on at the server if the person leaves; coming back finds the draft and the live version as they are. */
export function usePublishRun(client: ApiClient, { onLive }: Handlers) {
  const [run, setRun] = useState<string | null>(null)
  const [state, setState] = useState<Publishing>({ phase: 'idle' })
  const [round, setRound] = useState(0)
  const live = useRef(onLive)
  live.current = onLive

  useEffect(() => {
    if (!run) return
    let current = true
    let failures = 0
    let timer: ReturnType<typeof setTimeout> | undefined
    const read = () =>
      loadPublishRun(client, run).then(
        (answer) => {
          if (!current) return
          failures = 0
          if (answer && running(answer.step)) {
            setState({ phase: 'running', step: answer.step })
            timer = setTimeout(read, publishPollMs)
            return
          }
          setRun(null)
          if (answer?.step === 'live') {
            setState({ phase: 'idle' })
            live.current(answer.version)
          } else setState(answer?.step === 'rolled_back' ? { phase: 'rolledBack' } : { phase: 'failed', run: answer })
        },
        (error: unknown) => {
          if (!current) return
          failures += 1
          if (isApiError(error, 'FORBIDDEN') || failures >= publishReadTries) return setState({ phase: 'lost' })
          timer = setTimeout(read, publishPollMs)
        },
      )
    void read()
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [client, run, round])

  const follow = useCallback((id: string) => {
    setState({ phase: 'running', step: 'queued' })
    setRun(id)
  }, [])
  // A lost read keeps the run followed: the publish may still be going.
  const checkAgain = useCallback(() => {
    setState({ phase: 'running', step: 'queued' })
    setRound((n) => n + 1)
  }, [])
  // A refused or put-back publish stays in view until the draft is changed or thrown away.
  const dismiss = useCallback(() => setState({ phase: 'idle' }), [])

  return { state, follow, checkAgain, dismiss }
}
