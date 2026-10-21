import { useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { harnessEnabled } from '../../harness'
import { Plans, PlansError } from './Plans'
import { plansStates } from './plansHarness'

const plansRoute = getRouteApi('/_app/plans')
const shellRoute = getRouteApi('/_app')

export const PlansScreen = () => {
  const page = plansRoute.useLoaderData()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(plansStates, harnessEnabled)
  const router = useRouter()
  return <Plans me={me} page={page} forced={forced} onReload={() => void router.invalidate()} />
}

export const PlansRouteError = () => {
  const router = useRouter()
  return <PlansError onRetry={() => void router.invalidate()} />
}
