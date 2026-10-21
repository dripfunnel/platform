import { useCallback, useEffect, useRef, useState } from 'react'
import { AppState } from 'react-native'
import { loadStudioSession, renewStudioSession, type StudioSession } from '../../../api/studio'
import { isApiError, type ApiClient } from '../../../graphql'
import { frameOriginOf, openingPollMs, renewEveryMs, sandboxOf, type Sandbox } from './studioRules'

/** What the frame needs: its address, which carries the studio-session id, and the origin it may load from. The id is never drawn, stored or logged. */
export type Frame = { id: string; frameUrl: string; origin: string }

const endsSession = (error: unknown): boolean => isApiError(error, 'SESSION_ENDED') || isApiError(error, 'FORBIDDEN')

/** Opens the studio and keeps its session alive as the web studio does (AI-STUDIO §8); a refused renewal ends it, and Reopen asks for a new one. */
export function useStudioSession(client: ApiClient, portalHost: string) {
  const [frame, setFrame] = useState<Frame | null>(null)
  const [sandbox, setSandbox] = useState<Sandbox>({ kind: 'opening' })
  const [round, setRound] = useState(0)
  const frameId = useRef<string | null>(null)
  const ended = useRef(false)

  useEffect(() => {
    let current = true
    let timer: ReturnType<typeof setTimeout> | undefined
    ended.current = false
    frameId.current = null
    setFrame(null)
    setSandbox({ kind: 'opening' })

    const apply = (answer: StudioSession) => {
      if (!current) return
      const origin = frameOriginOf(answer.frameUrl, portalHost)
      if (origin === null) return setSandbox({ kind: 'failed', notConnected: false })
      frameId.current = answer.session
      setFrame((was) => (was?.id === answer.session ? was : { id: answer.session, frameUrl: answer.frameUrl, origin }))
      const next = sandboxOf(answer.state, answer.place)
      setSandbox(next)
      if (next.kind !== 'ready' && next.kind !== 'failed') timer = setTimeout(() => void read(answer.session), openingPollMs)
    }
    const fail = (error: unknown) => {
      if (!current) return
      if (endsSession(error)) {
        ended.current = true
        return setSandbox({ kind: 'ended' })
      }
      setSandbox({ kind: 'failed', notConnected: isApiError(error, 'NOT_CONNECTED') })
    }
    const read = (session: string | null) => loadStudioSession(client, session).then(apply, fail)
    void read(null)
    return () => {
      current = false
      clearTimeout(timer)
    }
  }, [client, portalHost, round])

  // A failed renewal is tried again at the next one; a refused one ends the session.
  const renew = useCallback(async () => {
    const id = frameId.current
    if (id === null || ended.current) return
    try {
      await renewStudioSession(client, id)
    } catch (error) {
      if (endsSession(error)) {
        ended.current = true
        setSandbox({ kind: 'ended' })
      }
    }
  }, [client])

  const live = frame !== null && sandbox.kind !== 'ended'
  useEffect(() => {
    if (!live) return
    const timer = setInterval(() => void renew(), renewEveryMs)
    const back = AppState.addEventListener('change', (next) => {
      if (next === 'active') void renew()
    })
    return () => {
      clearInterval(timer)
      back.remove()
    }
  }, [live, renew])

  // A refusal by `SESSION_ENDED` from any other call (a change, an undo, a publish) ends it as a refused renewal does.
  const end = useCallback(() => {
    ended.current = true
    setSandbox({ kind: 'ended' })
  }, [])

  return { frame, sandbox, reopen: useCallback(() => setRound((n) => n + 1), []), end }
}
