import type postgres from 'postgres'
import { GraphQLError } from 'graphql'
import type { TenantContext } from '#core/tenancy'
import { pageWindow, type PageRequest, type PageWindow } from '#core/paging'
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
