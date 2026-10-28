import { useRouter } from 'expo-router'
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import type { Notification, NotificationResponse } from 'expo-notifications'
import { useSession } from '../session/SessionContext'
import { pushIsSetUp, registerIfGranted, riderPushOf, type RiderPush } from './push'
import { loadNotifications } from '@dripfunnel/mobile-shared/push'

/** A delivery the store ended under the rider: cancelled before pickup, or recalled after it (docs/api/DELIVERY.md §3). */
export type Ended = { kind: 'cancelled' | 'recalled'; deliveryId: string | null }

type Push = {
  /** Goes up on every rider push, so Home asks the API again. */
  refresh: number
  ended: Ended | null
  dismissEnded: () => void
}

const PushContext = createContext<Push>({ refresh: 0, ended: null, dismissEnded: () => undefined })

export const usePush = (): Push => useContext(PushContext)

const opened = new Set<string>()

/** Mounted once under the session: a signed-in rider's phone is registered again quietly, pushes show while the app is open, a push makes Home look again, and a tapped one opens what it names. */
export function PushProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const { signedIn, client } = useSession()
  const [refresh, setRefresh] = useState(0)
  const [ended, setEnded] = useState<Ended | null>(null)

  const heard = useCallback((push: RiderPush) => {
    setRefresh((n) => n + 1)
    if (push.kind === 'cancelled' || push.kind === 'recalled') setEnded({ kind: push.kind, deliveryId: push.deliveryId })
  }, [])

  useEffect(() => {
    if (!pushIsSetUp()) return
    const Notifications = loadNotifications()
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }) })
    const received = (notification: Notification) => {
      const push = riderPushOf(notification.request.content.data)
      if (push) heard(push)
    }
    const tapped = (response: NotificationResponse | null) => {
      if (!response) return
      const push = riderPushOf(response.notification.request.content.data)
      const id = response.notification.request.identifier
      // The route is behind the session: a tap before sign-in is kept for the run that follows it, not marked as opened.
      if (!push || !signedIn || opened.has(id)) return
      opened.add(id)
      heard(push)
      if (push.kind !== 'offer' && push.kind !== 'taken' && push.deliveryId) router.push({ pathname: '/delivery/[id]', params: { id: push.deliveryId } })
      else router.navigate('/home')
    }
    tapped(Notifications.getLastNotificationResponse())
    const onReceived = Notifications.addNotificationReceivedListener(received)
    const onTapped = Notifications.addNotificationResponseReceivedListener(tapped)
    return () => {
      onReceived.remove()
      onTapped.remove()
    }
  }, [router, heard, signedIn])

  useEffect(() => {
    if (!pushIsSetUp() || !signedIn) return
    registerIfGranted(client).catch(() => undefined)
  }, [signedIn, client])

  const value = useMemo<Push>(() => ({ refresh, ended, dismissEnded: () => setEnded(null) }), [refresh, ended])
  return <PushContext.Provider value={value}>{children}</PushContext.Provider>
}
