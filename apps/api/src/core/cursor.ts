// Keyset cursors for lists sorted newest first (LOGGING.md §7, ui/admin/FIRST-RELEASE.md §12):
// the row's time and id, opaque to the client.
export interface Keyset {
  occurredAt: Date
  id: string
}

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

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
  if (!time || !id || extra !== undefined || !uuid.test(id)) return null
  const occurredAt = new Date(time)
  return Number.isNaN(occurredAt.getTime()) ? null : { occurredAt, id }
}
