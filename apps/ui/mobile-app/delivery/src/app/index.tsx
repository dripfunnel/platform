import { Redirect } from 'expo-router'
import { Loading, StateMessage } from '../features/common/ui'
import { useLoad } from '../features/common/useLoad'
import { errorText, t } from '../messages'
import { useSession } from '../session/SessionContext'

// The first-time profile is for a rider whose name or vehicle is still empty.
function Start() {
  const { state, reload } = useLoad(useSession().fetchRider)
  if (state.status === 'loading') return <Loading />
  if (state.status === 'offline') return <StateMessage title={t('states.offline.title')} body={t('states.offline.body')} actionLabel={t('common.retry')} onAction={reload} />
  if (state.status === 'error') return <StateMessage title={t('states.error.title')} body={errorText(state.code)} actionLabel={t('common.retry')} onAction={reload} />
  return <Redirect href={state.data.name?.trim() && state.data.vehicleType ? '/home' : '/setup'} />
}

// Where the app starts: getting in, the first-time profile, or Home.
export default function Index() {
  return useSession().signedIn ? <Start /> : <Redirect href="/sign-in" />
}
