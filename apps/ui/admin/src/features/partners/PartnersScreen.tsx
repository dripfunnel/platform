import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useCallback } from 'react'
import type { PartnerFilter } from '../../api/partners'
import { useScreenState } from '../common/useScreenState'
import { partnersStates } from './partnerHarness'
import { Partners, PartnersError } from './Partners'

const partnersRoute = getRouteApi('/_app/partners')
const shellRoute = getRouteApi('/_app')

export const PartnersScreen = () => {
  const page = partnersRoute.useLoaderData()
  const { status, setup, q } = partnersRoute.useSearch()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(partnersStates)
  const navigate = partnersRoute.useNavigate()
  const router = useRouter()
  // A new filter starts from the first page, so the cursors are dropped with the old one.
  const onFilterChange = useCallback((next: PartnerFilter) => void navigate({ search: next, replace: true }), [navigate])
  const filter: PartnerFilter = {
    ...(status ? { status } : {}),
    ...(setup ? { setup } : {}),
    ...(q ? { q } : {}),
  }
  return (
    <Partners
      page={page}
      filter={filter}
      forced={forced}
      readOnly={me.role === 'staff-read-only' || forced === 'readonly'}
      onFilterChange={onFilterChange}
      onReload={() => void router.invalidate()}
    />
  )
}

// The route's error view: it never shows the thrown error, whose message can carry internals.
export const PartnersRouteError = () => {
  const router = useRouter()
  return <PartnersError onRetry={() => void router.invalidate()} />
}
