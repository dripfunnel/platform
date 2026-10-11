// What the API's `StorefrontEdge` entrypoint answers (apps/api/src/index.ts), checked here as any input crossing a boundary.

export type LiveHost =
  | { kind: 'none' }
  | { kind: 'store'; storeId: string; partnerId: string; buildId: string | null; state: 'open' | 'suspended' | 'offline'; name: string; language: string }

export type PreviewAccess = { ok: true; storeId: string; userId: string; epoch: number; folder: string | null } | { ok: false }

export interface PreviewCheck {
  key: string
  storeId: string
  userId: string
  epoch: number
}

/** The service binding to the API's `StorefrontEdge` entrypoint: `/shop-api/*`, and its four questions. */
export interface EdgeApi {
  fetch: (request: Request) => Promise<Response>
  liveHost: (host: string) => Promise<unknown>
  redirect: (storeId: string, path: string) => Promise<unknown>
  openPreview: (key: string, token: string) => Promise<unknown>
  previewAccess: (check: PreviewCheck) => Promise<unknown>
}

const record = (value: unknown): Record<string, unknown> | null => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null)
const isId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f-]{36}$/.test(value)
// The folder names R2 keys under the store's prefix, so it must be one plain name (PREVIEW.md §3).
const isFolder = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9-]{1,64}$/.test(value)

export class EdgeAnswerInvalid extends Error {
  override name = 'EdgeAnswerInvalid'
}

export const parseLiveHost = (value: unknown): LiveHost => {
  const v = record(value)
  if (v?.['kind'] === 'none') return { kind: 'none' }
  const state = v?.['state']
  if (
    v?.['kind'] === 'store' &&
    isId(v['storeId']) &&
    isId(v['partnerId']) &&
    (v['buildId'] === null || isId(v['buildId'])) &&
    (state === 'open' || state === 'suspended' || state === 'offline') &&
    typeof v['name'] === 'string' &&
    typeof v['language'] === 'string'
  )
    return { kind: 'store', storeId: v['storeId'], partnerId: v['partnerId'], buildId: v['buildId'], state, name: v['name'], language: v['language'] }
  throw new EdgeAnswerInvalid('liveHost')
}

// The same rule as `_edge.json`'s paths (live.ts): plain names on the store's own host, never `//host` or `/\host`.
const isRedirectPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 2048 && /^(\/[A-Za-z0-9._~@+,=-]+)+$/.test(value)

/** A renamed address's new one, or null (storefront ARCHITECTURE §8). */
export const parseRedirect = (value: unknown): string | null => {
  const to = record(value)?.['to']
  if (to === null) return null
  if (isRedirectPath(to)) return to
  throw new EdgeAnswerInvalid('redirect')
}

export const parsePreviewAccess = (value: unknown): PreviewAccess => {
  const v = record(value)
  if (v?.['ok'] === false) return { ok: false }
  if (v?.['ok'] === true && isId(v['storeId']) && isId(v['userId']) && Number.isSafeInteger(v['epoch']) && (v['folder'] === null || isFolder(v['folder'])))
    return { ok: true, storeId: v['storeId'], userId: v['userId'], epoch: v['epoch'] as number, folder: v['folder'] }
  throw new EdgeAnswerInvalid('preview')
}
