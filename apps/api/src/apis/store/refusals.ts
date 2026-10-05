import type postgres from 'postgres'
import { GraphQLError } from 'graphql'
import type { TenantContext } from '#core/tenancy'
import { encodeCursor, decodeValueCursor, encodeValueCursor, type Keyset } from '#core/cursor'
import { pageWindow, pageWith, type Page, type PageRequest, type PageWindow } from '#core/paging'
import { planLimitFor, type PlanCheck } from '#saas/entitlements/index'

// The Store API's stable refusals that come from a resolver rather than the access policy
// (FIRST-RELEASE §19): each a code with its facts, worded by the portal.

/** At most 50 a page (FIRST-RELEASE §19). */
export const storePageSize = 50

export const storePage = (request: PageRequest): PageWindow => {
  const result = pageWindow(request, storePageSize)
  if (!result.ok) throw new GraphQLError('That page link has expired. Start again.', { extensions: { code: result.code } })
  return result.window
}

/** Refuses with `PLAN_LIMIT` and the plan that unlocks it when the store's plan doesn't allow this. */
export const requirePlan = async (sql: postgres.Sql, context: TenantContext, check: PlanCheck, now: Date): Promise<void> => {
  const limit = await planLimitFor(sql, context, check, now)
  if (!limit) return
  throw new GraphQLError('Your plan doesn’t include this.', {
    extensions: { code: 'PLAN_LIMIT', key: limit.key, limit: limit.limit, unlockedBy: limit.unlockedBy },
  })
}

/**
 * A page of a list sorted by `sort`: by time through the usual keyset cursor, by anything else through a value
 * cursor made for that sort (core/cursor); a cursor from another sort is refused like any bad one.
 */
export const sortedPage = (request: PageRequest, sort: string, byTime: boolean, fits: (value: string) => boolean = () => true): { limit: number; after: { value: string; id: string } | null; before: { value: string; id: string } | null } => {
  if (byTime) {
    const window = storePage(request)
    const keyOf = (k: Keyset | null) => (k ? { value: k.occurredAt.toISOString(), id: k.id } : null)
    return { limit: window.limit, after: keyOf(window.after), before: keyOf(window.before) }
  }
  // A well-formed cursor can still carry a value its sort's type can't hold; it is refused like any bad one.
  const read = (cursor: string) => {
    const key = decodeValueCursor(cursor, sort)
    return key && fits(key.value) ? key : null
  }
  const after = request.after ? read(request.after) : null
  const before = request.before ? read(request.before) : null
  if ((request.after && !after) || (request.before && !before)) throw new GraphQLError('That page link has expired. Start again.', { extensions: { code: 'INVALID_CURSOR' } })
  const limit = Math.min(Math.max(Math.floor(request.first ?? storePageSize), 1), storePageSize)
  return { limit, after: after ? { value: after.value, id: after.id } : null, before: before ? { value: before.value, id: before.id } : null }
}

/** The page's cursors carry each row's sort value, as sortedPage reads them back. */
export const sortedPageOf = <T>(rows: readonly T[], window: { limit: number; after: unknown; before: unknown }, sort: string, byTime: boolean, keyOf: (row: T) => { value: string; id: string }): Page<T> =>
  pageWith(rows, window, (row) => {
    const key = keyOf(row)
    return byTime ? encodeCursor({ occurredAt: new Date(key.value), id: key.id }) : encodeValueCursor({ sort, value: key.value, id: key.id })
  })
