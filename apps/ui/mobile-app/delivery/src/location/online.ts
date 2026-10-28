import * as Location from 'expo-location'
import { Platform } from 'react-native'
import type { ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { reportPosition, setOnline } from '../api/dispatch'
import { latestPosition } from './position'
import { startTracking, stopTracking } from './tracking'

/** The first point goes without making the rider wait for a fix; a failure waits for the task's next one. */
const sendFirstPosition = async (client: ApiClient): Promise<void> => {
  const first = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }).catch(() => null)
  const position = first ? latestPosition([first]) : null
  if (position) await reportPosition(client, position).catch(() => undefined)
}

export type WentOnline = 'online' | 'denied'

/**
 * Online: location is asked for first and the task started, and only then does the API hear `setOnline(true)`, followed at once by the first position
 * (docs/api/DELIVERY.md §3). Android runs the task as a foreground service, so "while using" is enough there; iOS is asked for "always" on top.
 */
export const goOnline = async (client: ApiClient, pickedUp: boolean): Promise<WentOnline> => {
  if (!(await Location.requestForegroundPermissionsAsync()).granted) return 'denied'
  if (Platform.OS === 'ios') await Location.requestBackgroundPermissionsAsync()
  await startTracking(pickedUp)
  try {
    await setOnline(client, true)
  } catch (error) {
    await stopTracking()
    throw error
  }
  void sendFirstPosition(client)
  return 'online'
}

/** Offline: the task stops before the API is told, so no point is sent after it. A refusal (a parcel in hand) puts the task back. */
export const goOffline = async (client: ApiClient, pickedUp: boolean): Promise<void> => {
  await stopTracking()
  try {
    await setOnline(client, false)
  } catch (error) {
    await startTracking(pickedUp).catch(() => undefined)
    throw error
  }
}
