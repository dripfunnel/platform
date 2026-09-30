import { getRouteApi, useRouter } from '@tanstack/react-router'
import { useScreenState } from '../common/useScreenState'
import { Approvals, ApprovalsError } from './Approvals'
import { approvalsStates } from './approvalsHarness'

const approvalsRoute = getRouteApi('/_app/approvals')

export const ApprovalsScreen = () => {
  const page = approvalsRoute.useLoaderData()
  const forced = useScreenState(approvalsStates)
  const router = useRouter()
  return <Approvals page={page} forced={forced} onReload={() => void router.invalidate()} />
}

export const ApprovalsRouteError = () => {
  const router = useRouter()
  return <ApprovalsError onRetry={() => void router.invalidate()} />
}
