import { z } from 'zod'
import type { ActivityEntry, RequestFacts } from '#auth/activity'
import { roleHas, type StaffPermission } from '#auth/permissions'
import type { StaffMember } from '#auth/staff'
import { decodeCursor, encodeCursor, type Keyset } from '#core/cursor'
import type { PageInfo } from '#saas/activity/index'

// What every Admin API service does the same way: refuse by role with a stable code, record
// the staff member as the actor, and page by keyset (ui/admin/FIRST-RELEASE.md §12).

/** A reason where FIRST-RELEASE §4.3 and §5.3 require one: present, trimmed, bounded. */
export const reasonText = z.string().trim().min(1).max(500)

export type Allowed<Code extends string> = { allowed: true } | { allowed: false; reason: Code }

export const roleGuard = <Code extends string>(staff: StaffMember, refusals: Partial<Record<StaffPermission, Code>>, fallback: Code) => {
  const may = (permission: StaffPermission): Allowed<Code> =>
    roleHas(staff.role, permission) ? { allowed: true } : { allowed: false, reason: refusals[permission] ?? fallback }
  const refusedBy = (permission: StaffPermission): { ok: false; code: Code } | null => {
    const p = may(permission)
    return p.allowed ? null : { ok: false, code: p.reason }
  }
  return { may, refusedBy }
}

/** An entry with the staff member as actor and the request's facts (LOGGING.md §4). */
export const staffEntry =
  (staff: StaffMember, facts: RequestFacts) =>
  (fields: Pick<ActivityEntry, 'action' | 'reason' | 'target' | 'visibility'> & Partial<ActivityEntry>): ActivityEntry => ({
    category: 'write',
    result: 'success',
    actorKind: 'staff',
    actorId: staff.id,
    actorLabel: `${staff.name} <${staff.email}>`,
    api: 'admin',
    ...facts,
    ...fields,
  })

export interface PageRequest {
  after?: string | null | undefined
  before?: string | null | undefined
  first?: number | null | undefined
}

export type DecodedPage = { ok: true; after: Keyset | undefined; before: Keyset | undefined; limit: number } | { ok: false }

/** The cursors and the size a list was asked for, capped at the API's page size. */
export const decodePage = (page: PageRequest, pageSize: number): DecodedPage => {
  const after = page.after ? decodeCursor(page.after) : undefined
  const before = page.before ? decodeCursor(page.before) : undefined
  if (after === null || before === null) return { ok: false }
  return { ok: true, after, before, limit: Math.min(Math.max(page.first ?? pageSize, 1), pageSize) }
}

/** One page from `limit + 1` rows read in list order, with its page info (decided on #19). */
export const pageOf = <Row>(rows: Row[], decoded: Extract<DecodedPage, { ok: true }>, keyOf: (row: Row) => Keyset): { rows: Row[]; pageInfo: PageInfo } => {
  const more = rows.length > decoded.limit
  const pageRows = decoded.before ? rows.slice(more ? 1 : 0) : rows.slice(0, decoded.limit)
  const first = pageRows[0]
  const last = pageRows.at(-1)
  return {
    rows: pageRows,
    pageInfo: {
      startCursor: first ? encodeCursor(keyOf(first)) : null,
      endCursor: last ? encodeCursor(keyOf(last)) : null,
      hasPreviousPage: decoded.before ? more : decoded.after !== undefined,
      hasNextPage: decoded.before ? true : more,
    },
  }
}
