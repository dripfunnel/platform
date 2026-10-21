import { useRouter } from 'expo-router'
import { useMemo } from 'react'
import { t } from '../../messages'
import { session } from '../../session'
import { flowDeps } from '../auth/deps'
import { signOut } from '../auth/signInFlow'
import { useFeedback } from './Feedback'

// What the avatar sheet and More both offer. Switching store leaves the session and drops the acting store and
// supplier (ARCHITECTURE.md §4 step 5); signing out is asked first, in a sheet (DESIGN.md §4).
export const useAccountActions = () => {
  const router = useRouter()
  const feedback = useFeedback()
  return useMemo(
    () => ({
      openProfile: () => router.push('/profile'),
      switchStore: () => session().leaveStore(),
      signOut: () =>
        feedback.sheet({ title: t('auth.signOutTitle'), body: t('auth.signOutBody'), confirm: t('auth.signOutConfirm'), danger: true, onConfirm: () => signOut(flowDeps()) }),
    }),
    [router, feedback],
  )
}
