import { useRouter } from 'expo-router'
import { useBrand } from '@dripfunnel/mobile-shared/brand'
import { Loading, StateMessage } from '../features/common/ui'
import { useLoad } from '../features/common/useLoad'
import { ProfileForm } from '../features/profile/ProfileForm'
import { errorText, t } from '../messages'
import { useSession } from '../session/SessionContext'

export default function Setup() {
  const router = useRouter()
  const { brand } = useBrand()
  const { state, reload } = useLoad(useSession().fetchRider)
  if (state.status === 'loading') return <Loading />
  if (state.status === 'offline') return <StateMessage title={t('states.offline.title')} body={t('states.offline.body')} actionLabel={t('common.retry')} onAction={reload} />
  if (state.status === 'error') return <StateMessage title={t('states.error.title')} body={errorText(state.code)} actionLabel={t('common.retry')} onAction={reload} />
  return <ProfileForm rider={state.data} mode="first" storeName={brand?.name ?? null} onSaved={() => router.replace('/home')} />
}
