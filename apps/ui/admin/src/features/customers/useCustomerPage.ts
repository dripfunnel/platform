import { useCallback, useEffect, useState } from 'react'
import { loadCustomers, type CustomerFilter, type CustomerPage } from '../../api/customers'
import type { PageRequest } from '@dripfunnel/shared/ui'

export type CustomerPageResult = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; page: CustomerPage }

// Fetched from the screen, not a route loader, because the search term is never in the URL
// (decided on #42). An answer that arrives after the request has changed is dropped.
export const useCustomerPage = (filter: CustomerFilter, page: PageRequest, search: string | null) => {
  const [result, setResult] = useState<CustomerPageResult>({ kind: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const { partner, store, status, via, created, lastSignIn } = filter
  const { after, before } = page

  useEffect(() => {
    let current = true
    setResult({ kind: 'loading' })
    loadCustomers({ partner, store, status, via, created, lastSignIn }, { after, before }, search)
      .then((loaded) => current && setResult({ kind: 'ready', page: loaded }))
      .catch(() => current && setResult({ kind: 'error' }))
    return () => {
      current = false
    }
  }, [partner, store, status, via, created, lastSignIn, after, before, search, attempt])

  const reload = useCallback(() => setAttempt((count) => count + 1), [])
  return { result, reload }
}
