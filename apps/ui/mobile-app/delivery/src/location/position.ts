import type { Position } from '../api/dispatch'

export type Point = { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number }

/** Of the points a wake-up delivers only the latest is sent; the others are dropped, never kept. */
export const latestPosition = (points: readonly Point[]): Position | null => {
  const latest = points[points.length - 1]
  if (!latest) return null
  return { lat: latest.coords.latitude, lng: latest.coords.longitude, accuracy: latest.coords.accuracy ?? 0, at: new Date(latest.timestamp).toISOString() }
}
