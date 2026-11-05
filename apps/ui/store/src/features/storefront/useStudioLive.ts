import { useEffect, useRef, useState } from 'react'
import type { LiveEvent, LiveStep } from '../../api/studio'
import type { StorefrontApi } from './storefrontApi'

export interface LiveRun {
  run: string
  /** A chat answer starts at `asking`; a change at `reading` (storefront AI-STUDIO §4 "Live progress"). */
  chat: boolean
  steps: { step: LiveStep; attempt: number | null; of: number | null }[]
  text: string
  /** The model's own sentence on what it understood and will change. */
  thought: string
  /** A plan's build (#1243): the page being built, of how many, and every page's title; its steps are that page's. */
  page: { index: number; of: number; titles: string[] } | null
}

const applied = (runs: readonly LiveRun[], e: LiveEvent): LiveRun[] => {
  const others = runs.filter((r) => r.run !== e.run)
  if (e.type === 'done' || e.type === 'error') return others
  const found = runs.find((r) => r.run === e.run) ?? { run: e.run, chat: e.type === 'step' && e.step === 'asking', steps: [], text: '', thought: '', page: null }
  const next =
    e.type === 'step'
      ? { ...found, steps: [...found.steps, { step: e.step, attempt: e.attempt ?? null, of: e.of ?? null }] }
      : e.type === 'page'
        ? { ...found, steps: [], text: '', thought: '', page: { index: e.index, of: e.of, titles: e.titles } }
        : e.type === 'thought'
          ? { ...found, thought: e.text }
          : { ...found, text: found.text + e.text }
  return [...others, next]
}

/**
 * The store's change or answer in progress, from any open studio of the store (two tabs show the same feed), and whether
 * the socket is up; `onEnd` runs when a run this studio saw in progress finishes.
 */
export const useStudioLive = (api: StorefrontApi, session: string | null, onEnd: () => void): { run: LiveRun | null; up: boolean } => {
  const [runs, setRuns] = useState<LiveRun[]>([])
  const [up, setUp] = useState(false)
  const ended = useRef(onEnd)
  useEffect(() => {
    ended.current = onEnd
  }, [onEnd])
  useEffect(() => {
    if (!session) return
    let current: LiveRun[] = []
    const live = api.openStudioLive(
      session,
      (event) => {
        const seen = current.some((r) => r.run === event.run)
        current = applied(current, event)
        setRuns(current)
        if (seen && (event.type === 'done' || event.type === 'error')) ended.current()
      },
      setUp,
    )
    return () => {
      live.close()
      setUp(false)
      setRuns([])
    }
  }, [api, session])
  return { run: runs.at(-1) ?? null, up }
}
