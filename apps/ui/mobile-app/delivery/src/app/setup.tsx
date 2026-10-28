import { useRouter } from 'expo-router'
import { useBrand } from '@dripfunnel/mobile-shared/brand'
import { Resource } from '../features/common/ui'
import { useLoad } from '../features/common/useLoad'
import { ProfileForm } from '../features/profile/ProfileForm'
import { useSession } from '../session/SessionContext'

export default function Setup() {
  const router = useRouter()
  const { brand } = useBrand()
  const { state, reload } = useLoad(useSession().fetchRider)
  return (
    <Resource state={state} onRetry={reload}>
      {(rider) => <ProfileForm rider={rider} mode="first" storeName={brand?.name ?? null} onSaved={() => router.replace('/')} />}
    </Resource>
  )
}
