// What the API's `StorefrontEdge` entrypoint answers (apps/api/src/index.ts), checked here as any input crossing a boundary.

export type LiveHost =
  | { kind: 'none' }
  | { kind: 'store'; storeId: string; partnerId: string; buildId: string | null; state: 'open' | 'suspended' | 'offline'; name: string; language: string; indexNowKey: string }

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
  redirects: (storeId: string) => Promise<unknown>
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
    typeof v['language'] === 'string' &&
    typeof v['indexNowKey'] === 'string' &&
    /^[a-f0-9]{32}$/.test(v['indexNowKey'])
  )
    return { kind: 'store', storeId: v['storeId'], partnerId: v['partnerId'], buildId: v['buildId'], state, name: v['name'], language: v['language'], indexNowKey: v['indexNowKey'] }
  throw new EdgeAnswerInvalid('liveHost')
}

// The same rule as `_edge.json`'s paths (live.ts): plain names on the store's own host, never `//host` or `/\host`.
const isRedirectPath = (value: unknown): value is string => typeof value === 'string' && value.length <= 2048 && /^(\/[A-Za-z0-9._~@+,=-]+)+$/.test(value)

export interface Redirects {
  /** Old path to new, as recorded. */
  exact: Map<string, string>
  /** The ones recorded for every language, which also apply under another language's prefix. */
  everyLanguage: Map<string, string>
}

/** A store's renamed addresses (storefront ARCHITECTURE §8); one that would leave the host refuses the answer. */
export const parseRedirects = (value: unknown): Redirects => {
  const list = record(value)?.['redirects']
  if (!Array.isArray(list) || list.length > 5_000) throw new EdgeAnswerInvalid('redirects')
  const found: Redirects = { exact: new Map(), everyLanguage: new Map() }
  for (const entry of list as unknown[]) {
    const r = record(entry)
    if (!isRedirectPath(r?.['from']) || !isRedirectPath(r?.['to']) || typeof r['everyLanguage'] !== 'boolean') throw new EdgeAnswerInvalid('redirects')
    found.exact.set(r['from'], r['to'])
    if (r['everyLanguage']) found.everyLanguage.set(r['from'], r['to'])
  }
  return found
}

export const parsePreviewAccess = (value: unknown): PreviewAccess => {
  const v = record(value)
  if (v?.['ok'] === false) return { ok: false }
  if (v?.['ok'] === true && isId(v['storeId']) && isId(v['userId']) && Number.isSafeInteger(v['epoch']) && (v['folder'] === null || isFolder(v['folder'])))
    return { ok: true, storeId: v['storeId'], userId: v['userId'], epoch: v['epoch'] as number, folder: v['folder'] }
  throw new EdgeAnswerInvalid('preview')
}
