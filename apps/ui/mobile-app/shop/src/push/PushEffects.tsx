import { useRouter } from 'expo-router'
import { useEffect } from 'react'
import type { NotificationResponse } from 'expo-notifications'
import { useShop } from '../api/ShopContext'
import { orderOfPush, pushIsSetUp, registerIfGranted } from './push'
import { loadNotifications } from '@dripfunnel/mobile-shared/push'

const opened = new Set<string>()

/** Mounted once under the providers: a signed-in customer's phone is registered again quietly, pushes show while the app is open, and a tapped push opens that order's tracking. */
export function PushEffects() {
  const router = useRouter()
  const { signedIn, client } = useShop()

  useEffect(() => {
    if (!pushIsSetUp()) return
    const Notifications = loadNotifications()
    Notifications.setNotificationHandler({ handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: false, shouldSetBadge: false }) })
    const open = (response: NotificationResponse | null) => {
      if (!response) return
      const order = orderOfPush(response.notification.request.content.data)
      const id = response.notification.request.identifier
      if (!order || opened.has(id)) return
      opened.add(id)
      router.push({ pathname: '/orders/[id]/track', params: { id: order } })
    }
    open(Notifications.getLastNotificationResponse())
    const subscription = Notifications.addNotificationResponseReceivedListener(open)
    return () => subscription.remove()
  }, [router])

  useEffect(() => {
    if (!pushIsSetUp() || !signedIn) return
    registerIfGranted(client, null).catch(() => undefined)
  }, [signedIn, client])

  return null
}
