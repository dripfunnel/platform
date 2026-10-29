import { vi } from 'vitest'

export interface MetricLine {
  event: 'metric'
  api: string
  storeId: string
  metric: string
  value: number
  code?: string
}

/** The technical log lines the Worker writes through `console.log`, parsed; `metrics()` is the measurements among them. */
export const captureLogs = () => {
  const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const lines = (): Record<string, unknown>[] =>
    spy.mock.calls.flatMap(([line]) => {
      try {
        return [JSON.parse(String(line)) as Record<string, unknown>]
      } catch {
        return []
      }
    })
  return {
    lines,
    metrics: (name?: string): MetricLine[] => lines().filter((line): line is MetricLine & Record<string, unknown> => line['event'] === 'metric' && (name === undefined || line['metric'] === name)),
    clear: () => spy.mockClear(),
    restore: () => spy.mockRestore(),
  }
}

/** A measurement carries the store and nothing else that names anyone (SAAS §12; DELIVERY §3). */
export const metricKeys = ['event', 'api', 'storeId', 'metric', 'value', 'code']
