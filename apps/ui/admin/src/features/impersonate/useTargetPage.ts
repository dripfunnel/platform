import { useCallback, useEffect, useState } from 'react'
import { loadTargets, type TargetFilter, type TargetPage } from '../../api/impersonation'
import type { PageRequest } from '../../api/pageInfo'
import type { StaffRole } from '../shell/staffRoles'
import { useSessionsVersion } from './sessionEvents'

export type TargetPageResult = { kind: 'loading' } | { kind: 'error' } | { kind: 'denied' } | { kind: 'ready'; page: TargetPage }

// Fetched from the screen, as Customers is, because the search term never reaches the URL
// (FIRST-RELEASE.md §8). Reloads when a session starts or ends, so Return to session is current.
export const useTargetPage = (filter: TargetFilter, page: PageRequest, search: string | null, caller: StaffRole) => {
  const [result, setResult] = useState<TargetPageResult>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const version = useSessionsVersion()
  const { type, partner, store, role, status } = filter
  const { after, before } = page

  useEffect(() => {
    let current = true
    setResult({ kind: 'loading' })
    loadTargets({ type, partner, store, role, status }, { after, before }, search, caller)
      .then((loaded) => current && setResult(loaded ? { kind: 'ready', page: loaded } : { kind: 'denied' }))
      .catch(() => current && setResult({ kind: 'error' }))
    return () => {
      current = false
    }
  }, [type, partner, store, role, status, after, before, search, caller, attempt, version])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { result, reload }
}
