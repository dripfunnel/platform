import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { z } from 'zod'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { secureStorage } from '@dripfunnel/mobile-shared/storage'
import { registerPushDevice, unregisterPushDevice, type PushPlatform } from '../api/push'
import { storeHost } from '@dripfunnel/mobile-shared/brand'
import { t } from '../messages'
import { pushProjectId } from './config'
import { loadNotifications } from './sdk'

// Pushes arrive through Expo's push service (api/DELIVERY.md §6), so the phone registers an Expo token. Nothing here runs for a store with
// no EAS project, and a push never carries the handover code, an address or an amount: the app reads those from the API.

export const pushIsSetUp = (): boolean => pushProjectId() !== null

export type Permission = 'unavailable' | 'undetermined' | 'granted' | 'denied'

const platformOf = (): PushPlatform => (Platform.OS === 'ios' ? 'ios' : 'android')

const noLast = (): null => null
const phoneStorage = () => secureStorage<null>(`${storeHost()}.push`, noLast)
const askedKey = () => `df.push.asked.${storeHost()}`

export const pushPermission = async (): Promise<Permission> => {
  if (!pushIsSetUp()) return 'unavailable'
  const { status } = await loadNotifications().getPermissionsAsync()
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

/** Whether the shopper has been asked already: once, after the first order, never at launch and never twice. */
export const hasAsked = async (): Promise<boolean> => (await AsyncStorage.getItem(askedKey())) !== null
export const markAsked = (): Promise<void> => AsyncStorage.setItem(askedKey(), '1')

const phoneToken = async (): Promise<string> => {
  const Notifications = loadNotifications()
  // Android 13 and later show the permission only once the app has a channel.
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: t('push.channel'), importance: Notifications.AndroidImportance.DEFAULT })
  const projectId = pushProjectId()
  if (!projectId) throw new Error('This build sets up no push (docs/mobile-app/README.md §3).')
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data
}

/** This phone for a signed-in customer (no `orderId`), or for a guest's order (its client carries the order's token). */
export const registerThisPhone = async (client: ApiClient, orderId: string | null): Promise<void> => {
  const token = await phoneToken()
  await registerPushDevice(client, token, platformOf(), orderId)
  if (!orderId) await phoneStorage().writeToken(token)
}

export type Asked = 'registered' | 'denied' | 'unavailable' | 'failed'

/** The system's permission prompt when it has not been answered, then the registration. */
export const askAndRegister = async (client: ApiClient, orderId: string | null): Promise<Asked> => {
  if (!pushIsSetUp()) return 'unavailable'
  try {
    const Notifications = loadNotifications()
    const now = await Notifications.getPermissionsAsync()
    const status = now.status === 'granted' ? 'granted' : (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') return 'denied'
    await registerThisPhone(client, orderId)
    return 'registered'
  } catch {
    return 'failed'
  }
}

/** A phone that already has permission is registered again quietly (its token can change), and never asked. */
export const registerIfGranted = async (client: ApiClient, orderId: string | null): Promise<void> => {
  if ((await pushPermission()) === 'granted') await registerThisPhone(client, orderId)
}

/** On sign-out the phone stops getting this customer's pushes, before the session goes (api/DELIVERY.md §6). With no signal the token stays kept: the next registration of this phone moves it. */
export const unregisterThisPhone = async (client: ApiClient): Promise<void> => {
  if (!pushIsSetUp()) return
  const storage = phoneStorage()
  const { token } = await storage.read()
  if (!token) return
  await unregisterPushDevice(client, token, null).catch(() => unregisterPushDevice(client, token, null))
  await storage.wipe()
}

const dataSchema = z.object({ kind: z.string(), orderId: z.string().min(1) })

/** The order a push names, for a customer message (`order.*`); null for anything else. Its data is only `{ kind, orderId }`. */
export const orderOfPush = (data: unknown): string | null => {
  const parsed = dataSchema.safeParse(data)
  return parsed.success && parsed.data.kind.startsWith('order.') ? parsed.data.orderId : null
}
