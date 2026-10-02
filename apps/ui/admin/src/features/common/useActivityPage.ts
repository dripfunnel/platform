import { useCallback, useEffect, useState } from 'react'
import { loadActivity, type ActivityFilter, type ActivityPage } from '../../api/activity'
import type { PageRequest } from '@dripfunnel/shared/graphql'
import type { StaffRole } from '../shell/staffRoles'

export type ActivityPageResult = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: ActivityPage }

// A tab loads its entries itself, inside a page whose loader has already answered; a late answer is dropped.
export const useActivityPage = (filter: ActivityFilter, page: PageRequest, caller: StaffRole) => {
  const [result, setResult] = useState<ActivityPageResult>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  // A new object each render, so the request is keyed on what it asks for.
  const request = JSON.stringify({ filter, page, caller })

  useEffect(() => {
    let current = true
    setResult({ kind: 'loading' })
    loadActivity(filter, page, caller)
      .then((loaded) => current && setResult({ kind: 'ready', page: loaded }))
      .catch(() => current && setResult({ kind: 'error' }))
    return () => {
      current = false
    }
  }, [request, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { result, reload }
}
