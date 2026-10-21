import { decodeCursor, encodeCursor, type Keyset } from './cursor'

// Keyset pages newest first, with no totals (FIRST-RELEASE §19 for the Store API, as
// ui/admin/FIRST-RELEASE §12 decided for the consoles). Counts come from their own queries.

export interface PageRequest {
  first?: number | null | undefined
  after?: string | null | undefined
  before?: string | null | undefined
}

export interface PageInfo {
  startCursor: string | null
  endCursor: string | null
  hasPreviousPage: boolean
  hasNextPage: boolean
}

export interface Page<T> {
  nodes: T[]
  pageInfo: PageInfo
}

export interface PageWindow {
  /** Rows to return; fetch one more to know whether another page follows. */
  limit: number
  after: Keyset | null
  before: Keyset | null
}

/** A bad cursor is the caller's error, refused with a stable code rather than read as page one. */
export type PageWindowResult = { ok: true; window: PageWindow } | { ok: false; code: 'INVALID_CURSOR' }

export const pageWindow = (request: PageRequest, maxSize: number): PageWindowResult => {
  const after = request.after ? decodeCursor(request.after) : null
  const before = request.before ? decodeCursor(request.before) : null
  if ((request.after && !after) || (request.before && !before)) return { ok: false, code: 'INVALID_CURSOR' }
  const limit = Math.min(Math.max(Math.floor(request.first ?? maxSize), 1), maxSize)
  return { ok: true, window: { limit, after, before } }
}

/** The page from `limit + 1` rows fetched in the list's order; reading backwards (`before`) they arrive reversed and are turned round here. */
export const pageWith = <T>(rows: readonly T[], window: { limit: number; after: unknown; before: unknown }, cursorOf: (row: T) => string): Page<T> => {
  const backwards = window.before !== null && window.after === null
  const more = rows.length > window.limit
  const kept = rows.slice(0, window.limit)
  const nodes = backwards ? [...kept].reverse() : kept
  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  return {
    nodes,
    pageInfo: {
      startCursor: first ? cursorOf(first) : null,
      endCursor: last ? cursorOf(last) : null,
      hasPreviousPage: backwards ? more : window.after !== null,
      hasNextPage: backwards ? window.before !== null : more,
    },
  }
}

/** The page from rows fetched newest first, `limit + 1` of them, each cursor the row's time and id. */
export const pageOf = <T>(rows: readonly T[], window: PageWindow, keyOf: (row: T) => Keyset): Page<T> => pageWith(rows, window, (row) => encodeCursor(keyOf(row)))
