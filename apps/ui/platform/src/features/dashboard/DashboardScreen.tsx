import { useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { harnessEnabled } from '../../harness'
import { Dashboard } from './Dashboard'
import { dashboardStates } from './dashboardStates'

const dashboardRoute = getRouteApi('/_app/dashboard')
const shellRoute = getRouteApi('/_app')

export const DashboardScreen = () => {
  const data = dashboardRoute.useLoaderData()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(dashboardStates, harnessEnabled)
  const navigate = dashboardRoute.useNavigate()
  const router = useRouter()
  return <Dashboard me={me} data={data} forced={forced} onRangeChange={(range) => void navigate({ search: (prev) => ({ ...prev, range }) })} onReload={() => void router.invalidate()} />
}
