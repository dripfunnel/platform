import * as Location from 'expo-location'
import { t } from '../messages'

// The rider's position while Online and only then: one background task, every 60 s, every 15 s while a delivery is picked up
// (docs/api/DELIVERY.md §7). A position is sent and forgotten: nothing here keeps a trail or logs a point.
export const trackingTask = 'df-delivery-position'

export const onlineIntervalMs = 60_000
export const pickedUpIntervalMs = 15_000

export const intervalFor = (pickedUp: boolean): number => (pickedUp ? pickedUpIntervalMs : onlineIntervalMs)

export const isTracking = (): Promise<boolean> => Location.hasStartedLocationUpdatesAsync(trackingTask)

export const startTracking = (pickedUp: boolean): Promise<void> =>
  Location.startLocationUpdatesAsync(trackingTask, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: intervalFor(pickedUp),
    distanceInterval: 0,
    pausesUpdatesAutomatically: false,
    showsBackgroundLocationIndicator: true,
    // Android runs the task as a foreground service, which has to show this notification.
    foregroundService: { notificationTitle: t('online.notification.title'), notificationBody: t('online.notification.body') },
  })

export const stopTracking = async (): Promise<void> => {
  if (await isTracking()) await Location.stopLocationUpdatesAsync(trackingTask)
}

/** Starts the task again at the interval its delivery state asks for; nothing happens while the rider is not online. */
export const retime = async (pickedUp: boolean): Promise<void> => {
  if (!(await isTracking())) return
  await stopTracking()
  await startTracking(pickedUp)
}
