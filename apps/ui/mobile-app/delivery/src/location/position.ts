import type { Position } from '../api/dispatch'

export type Point = { coords: { latitude: number; longitude: number; accuracy: number | null }; timestamp: number }

// Only the latest point is sent, the others dropped. One with no accuracy is dropped too: the API has no unknown accuracy, and 0 m would pass as an exact fix.
export const latestPosition = (points: readonly Point[]): Position | null => {
  const known = points.flatMap((point) => (point.coords.accuracy === null ? [] : [{ ...point, accuracy: point.coords.accuracy }]))
  const latest = known[known.length - 1]
  if (!latest) return null
  return { lat: latest.coords.latitude, lng: latest.coords.longitude, accuracy: latest.accuracy, at: new Date(latest.timestamp).toISOString() }
}
