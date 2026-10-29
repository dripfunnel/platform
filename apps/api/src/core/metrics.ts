import { logEvent } from './log'

// The platform's dispatch measurements (docs/api/DELIVERY.md §3; SAAS.md §12): one technical log line each, tagged with the store only,
// never a rider, a customer or a delivery. Collected inside a transaction and emitted once it has committed.

export const metricNames = ['dispatch_accept_seconds', 'dispatch_unassigned', 'dispatch_offers_per_delivery', 'push_send_failed', 'dispatch_late_step'] as const
export type MetricName = (typeof metricNames)[number]

export interface Measurement {
  storeId: string
  metric: MetricName
  value: number
  /** Expo's error code, for `push_send_failed` only. */
  code?: string
}

export const emitMeasurements = (measurements: readonly Measurement[]): void => {
  for (const { storeId, metric, value, code } of measurements) logEvent({ event: 'metric', api: 'system', storeId, metric, value, ...(code ? { code } : {}) })
}
