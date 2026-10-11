import type { EdgeApi } from './edge'
import type { SessionSeal } from './session'

/** What a request is served with; index.ts builds it from the bindings, tests from fakes. */
export interface Deps {
  edge: EdgeApi
  sites: R2Bucket
  cache: Cache
  waitUntil: (work: Promise<unknown>) => void
  now: () => number
  /** Null where PREVIEW_DOMAIN or PREVIEW_SESSION_KEY isn't set: preview hosts then answer the closed page. */
  sessions: SessionSeal | null
}

/** Stores a copy for later requests without holding up this one; a failed put only costs a later miss. */
export const remember = (deps: Deps, key: string, response: Response): void => {
  deps.waitUntil(deps.cache.put(key, response).catch(() => undefined))
}
