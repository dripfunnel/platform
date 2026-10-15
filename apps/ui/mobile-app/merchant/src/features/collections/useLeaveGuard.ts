import { useNavigation, useRouter } from 'expo-router'
import { usePreventRemove } from 'expo-router/react-navigation'
import { useEffect, useState } from 'react'
import { t } from '../../messages'
import { useFeedback } from '../shell/Feedback'

/**
 * Leaving an editor with changes not saved asks first (the web's "Leave without saving?"). `go` leaves by the way it is given once
 * what was saved has been; `finish` goes back. `leaving` is true from then on, so neither that nor a discard is asked about again.
 */
export function useLeaveGuard(dirty: boolean): { leaving: boolean; go: (leave: () => void) => void; finish: () => void } {
  const router = useRouter()
  const navigation = useNavigation()
  const feedback = useFeedback()
  const [exit, setExit] = useState<(() => void) | null>(null)

  useEffect(() => {
    exit?.()
  }, [exit])

  usePreventRemove(dirty && exit === null, ({ data: { action } }) =>
    feedback.menu({
      title: t('collections.leave.title'),
      sub: t('collections.leave.body'),
      items: [
        { key: 'keep', label: t('collections.leave.keep'), onPress: () => undefined },
        { key: 'discard', label: t('collections.leave.discard'), danger: true, onPress: () => setExit(() => () => navigation.dispatch(action)) },
      ],
    }),
  )

  const go = (leave: () => void) => setExit(() => leave)
  return { leaving: exit !== null, go, finish: () => go(() => router.back()) }
}
