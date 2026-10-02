import { useScreenState } from '@dripfunnel/shared/ui'
import { getRouteApi, useRouter } from '@tanstack/react-router'
import { createStore, loadProvisioning } from '../../api/stores'
import { harnessEnabled } from '../../harness'
import { CreateStore, CreateStoreError, CreateStoreLoading } from './CreateStore'
import { createStates } from './storeHarness'

const createRoute = getRouteApi('/_app/stores_/new')
const shellRoute = getRouteApi('/_app')

export const CreateStoreScreen = () => {
  const form = createRoute.useLoaderData()
  const { me } = shellRoute.useLoaderData()
  const forced = useScreenState(createStates, harnessEnabled)
  return <CreateStore me={me} form={form} forced={forced} onCreate={(input) => createStore(input, me.role, me.partner.state)} progressOf={loadProvisioning} />
}

export const CreateStorePending = () => {
  const { me } = createRoute.useRouteContext()
  return <CreateStoreLoading host={me.partner.host} />
}

export const CreateStoreRouteError = () => {
  const router = useRouter()
  const { me } = createRoute.useRouteContext()
  return <CreateStoreError host={me.partner.host} onRetry={() => void router.invalidate()} />
}
