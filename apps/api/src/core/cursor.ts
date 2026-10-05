import { isUuid } from '#core/ids'

// Keyset cursors for lists sorted newest first (LOGGING.md §7, ui/admin/FIRST-RELEASE.md §12):
// the row's time and id, opaque to the client.
export interface Keyset {
  occurredAt: Date
  id: string
}


export const encodeCursor = ({ occurredAt, id }: Keyset): string =>
  btoa(`${occurredAt.toISOString()}|${id}`).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')

export const decodeCursor = (cursor: string): Keyset | null => {
  let text: string
  try {
    text = atob(cursor.replaceAll('-', '+').replaceAll('_', '/'))
  } catch {
    return null
  }
  const [time, id, extra] = text.split('|')
  if (!time || !id || extra !== undefined || !isUuid(id)) return null
  const occurredAt = new Date(time)
  return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, id }
}

/** A list sorted by something other than time (a name, a price, a count): the row's sort value and id, and the sort it was for. */
export interface ValueKeyset {
  sort: string
  value: string
  id: string
}

// UTF-8 through base64url: a name may be in any script.
const toBase64Url = (text: string): string =>
  btoa(String.fromCharCode(...new TextEncoder().encode(text))).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
const fromBase64Url = (text: string): string => new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(atob(text.replaceAll('-', '+').replaceAll('_', '/')), (c) => c.charCodeAt(0)))

export const encodeValueCursor = ({ sort, value, id }: ValueKeyset): string => toBase64Url(`v|${sort}|${id}|${value}`)

/** Null for anything not made by encodeValueCursor for this sort: a cursor never crosses sorts. */
export const decodeValueCursor = (cursor: string, sort: string): ValueKeyset | null => {
  let text: string
  try {
    text = fromBase64Url(cursor)
  } catch {
    return null
  }
  const [tag, cursorSort, id, ...rest] = text.split('|')
  if (tag !== 'v' || cursorSort !== sort || !id || !isUuid(id) || rest.length === 0) return null
  return { sort, value: rest.join('|'), id }
}
