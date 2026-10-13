import { useLocalSearchParams, useRouter } from 'expo-router'
import { t } from '../../messages'
import { Button } from '../common/Button'
import { AuthFrame } from './AuthFrame'

// Five wrong passwords or codes in a row pause sign-in (ACCESS.md §4); a reset gets the person back in sooner.
export function LockedScreen() {
  const router = useRouter()
  const { minutes } = useLocalSearchParams<{ minutes?: string }>()
  return (
    <AuthFrame title={t('auth.lockedTitle')} sub={t('auth.lockedSub', { minutes: minutes ?? '15' })}>
      <Button label={t('auth.lockedReset')} onPress={() => router.replace('/forgot-password')} />
      <Button kind="secondary" label={t('auth.backToSignIn')} onPress={() => router.replace('/sign-in')} />
    </AuthFrame>
  )
}
