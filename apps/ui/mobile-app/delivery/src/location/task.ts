import * as TaskManager from 'expo-task-manager'
import { storeHost } from '@dripfunnel/mobile-shared/brand'
import { isApiError } from '@dripfunnel/mobile-shared/graphql'
import { createDeliveryClient } from '../api/client'
import { reportPosition } from '../api/dispatch'
import { loadToken } from '../session/token'
import { latestPosition, type Point } from './position'
import { stopTracking, trackingTask } from './tracking'

/** Sends the latest point with the token in secure storage. No token, or a session the API has ended, stops the task; any other failure waits for the next point. */
export const reportLatest = async (points: readonly Point[]): Promise<void> => {
  const position = latestPosition(points)
  if (!position) return
  const host = storeHost()
  const token = await loadToken(host)
  if (!token) return stopTracking()
  try {
    await reportPosition(createDeliveryClient(host, { token: () => token }), position)
  } catch (error) {
    if (isApiError(error, 'UNAUTHENTICATED')) await stopTracking()
  }
}

// Defined when the app's code is loaded, which is where the system looks for it when it wakes the app (docs/mobile-app/delivery/ARCHITECTURE.md §2).
TaskManager.defineTask<{ locations?: Point[] }>(trackingTask, async ({ data, error }) => {
  if (error) return
  await reportLatest(data?.locations ?? [])
})
