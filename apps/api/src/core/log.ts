// Technical logs (LOGGING.md §9): ids, codes and timings, never a name, an email, an address
// or a payload. The key list is the whole contract; `technicalLine` drops anything else.
export const technicalLogKeys = [
  'event',
  'requestId',
  'api',
  'host',
  'partnerId',
  'storeId',
  'sellerId',
  'status',
  'durationMs',
  'code',
  'count',
] as const

export type TechnicalLogKey = (typeof technicalLogKeys)[number]

export interface TechnicalEvent {
  event: string
  requestId?: string | null
  api?: 'admin' | 'platform' | 'store' | 'shop' | 'hooks' | 'system' | null
  host?: string | null
  partnerId?: string | null
  storeId?: string | null
  sellerId?: string | null
  status?: number
  durationMs?: number
  code?: string
  count?: number
}

export const technicalLine = (event: TechnicalEvent): string => {
  const line: Partial<Record<TechnicalLogKey, unknown>> = {}
  for (const key of technicalLogKeys) {
    const value = event[key]
    if (value !== undefined) line[key] = value
  }
  return JSON.stringify(line)
}

export const logEvent = (event: TechnicalEvent): void => {
  console.log(technicalLine(event))
}
