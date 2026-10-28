import AsyncStorage from '@react-native-async-storage/async-storage'
import { Platform } from 'react-native'
import { z } from 'zod'
import { storeHost } from '@dripfunnel/mobile-shared/brand'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { secureStorage } from '@dripfunnel/mobile-shared/storage'
import { registerPushDevice, unregisterPushDevice, type PushPlatform } from '../api/dispatch'
import { t } from '../messages'
import { pushProjectId } from './config'
import { loadNotifications } from './sdk'

// Pushes arrive through Expo's push service (docs/api/DELIVERY.md §6), so the phone registers an Expo token. Nothing here runs for a store with
// no EAS project, and a push never carries an address, a phone number or an amount: the app reads those from the API.
export const pushIsSetUp = (): boolean => pushProjectId() !== null

export type Permission = 'unavailable' | 'undetermined' | 'granted' | 'denied'

const platformOf = (): PushPlatform => (Platform.OS === 'ios' ? 'ios' : 'android')

const phoneStorage = () => secureStorage<null>(`${storeHost()}.push`, () => null)
const askedKey = () => `df.push.asked.${storeHost()}`

export const pushPermission = async (): Promise<Permission> => {
  if (!pushIsSetUp()) return 'unavailable'
  const { status } = await loadNotifications().getPermissionsAsync()
  return status === 'granted' ? 'granted' : status === 'denied' ? 'denied' : 'undetermined'
}

/** Whether the rider has been asked already: once, at the first sign-in, and never twice. */
export const hasAsked = async (): Promise<boolean> => (await AsyncStorage.getItem(askedKey())) !== null
export const markAsked = (): Promise<void> => AsyncStorage.setItem(askedKey(), '1')

const phoneToken = async (): Promise<string> => {
  const Notifications = loadNotifications()
  // Android 13 and later show the permission only once the app has a channel.
  if (Platform.OS === 'android') await Notifications.setNotificationChannelAsync('default', { name: t('push.channel'), importance: Notifications.AndroidImportance.HIGH })
  const projectId = pushProjectId()
  if (!projectId) throw new Error('This build sets up no push (docs/mobile-app/README.md §3).')
  return (await Notifications.getExpoPushTokenAsync({ projectId })).data
}

export const registerThisPhone = async (client: ApiClient): Promise<void> => {
  const token = await phoneToken()
  await registerPushDevice(client, token, platformOf())
  await phoneStorage().writeToken(token)
}

export type Asked = 'registered' | 'denied' | 'unavailable' | 'failed'

/** The system's permission prompt when it has not been answered, then the registration. */
export const askAndRegister = async (client: ApiClient): Promise<Asked> => {
  if (!pushIsSetUp()) return 'unavailable'
  try {
    const Notifications = loadNotifications()
    const now = await Notifications.getPermissionsAsync()
    const status = now.status === 'granted' ? 'granted' : (await Notifications.requestPermissionsAsync()).status
    if (status !== 'granted') return 'denied'
    await registerThisPhone(client)
    return 'registered'
  } catch {
    return 'failed'
  }
}

/** A phone that already has permission is registered again quietly (its token can change), and never asked. */
export const registerIfGranted = async (client: ApiClient): Promise<void> => {
  if ((await pushPermission()) === 'granted') await registerThisPhone(client)
}

/** On sign-out the phone stops getting this rider's pushes (docs/api/DELIVERY.md §6). With no signal the token stays kept: the API deletes it with the session either way. */
export const unregisterThisPhone = async (client: ApiClient): Promise<void> => {
  if (!pushIsSetUp()) return
  const storage = phoneStorage()
  const { token } = await storage.read()
  if (!token) return
  await unregisterPushDevice(client, token)
  await storage.wipe()
}

const dataSchema = z.object({ kind: z.string(), deliveryId: z.string().min(1).optional() })

export type RiderPush = { kind: 'offer' | 'assigned' | 'taken' | 'cancelled' | 'recalled'; deliveryId: string | null }

const kinds = { 'rider.offer': 'offer', 'rider.assigned': 'assigned', 'rider.taken': 'taken', 'rider.cancelled': 'cancelled', 'rider.recalled': 'recalled' } as const

/** What a rider message says (`rider.*`, with only `{ kind, deliveryId }` as data); null for anything else, such as the "notifications are on" confirmation. */
export const riderPushOf = (data: unknown): RiderPush | null => {
  const parsed = dataSchema.safeParse(data)
  if (!parsed.success) return null
  const kind = (kinds as Record<string, RiderPush['kind'] | undefined>)[parsed.data.kind]
  return kind ? { kind, deliveryId: parsed.data.deliveryId ?? null } : null
}
