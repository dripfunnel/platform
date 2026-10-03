import type postgres from 'postgres'
import { z } from 'zod'
import { decodeCursor, encodeCursor } from '#core/cursor'
import type { CallerContext } from '#core/tenancy'
import { isPartnerContext, isTenantContext } from '#core/tenancy'
import { activityResults, actorKinds, type ActivityRow } from '#db/schema/activity'
import { activityLevels, activityWhos, selectActivity } from '#db/scoped/activity'
import { withScope } from '#db/scoped/index'

// The admin console reads 50 at a time (ui/admin/FIRST-RELEASE.md §9); nothing asks for more.
export const activityPageSize = 50

export const activityFilter = z
  .object({
    actorKind: z.enum(actorKinds).optional(),
    actorId: z.string().min(1).max(200).optional(),
    targetType: z.string().min(1).max(100).optional(),
    targetId: z.string().min(1).max(200).optional(),
    partnerId: z.guid().optional(),
    storeId: z.guid().optional(),
    customerId: z.guid().optional(),
    action: z.string().min(1).max(100).optional(),
    who: z.enum(activityWhos).optional(),
    result: z.enum(activityResults).optional(),
    level: z.enum(activityLevels).optional(),
    ip: z.union([z.ipv4(), z.ipv6()]).optional(),
    accessRef: z.guid().optional(),
    personKind: z.enum(actorKinds).optional(),
    personId: z.string().min(1).max(200).optional(),
    /** UTC calendar days, inclusive (FIRST-RELEASE §9). */
    from: z.iso.date().optional(),
    to: z.iso.date().optional(),
  })
  .strict()
  .refine((f) => !f.from || !f.to || f.from <= f.to, { message: 'from is after to' })
  .refine((f) => (f.personKind === undefined) === (f.personId === undefined), { message: 'a person needs its kind and id' })

export type ActivityFilter = z.infer<typeof activityFilter>

export interface ActivityPageRequest {
  after?: string | null | undefined
  before?: string | null | undefined
  first?: number | null | undefined
}

export interface PageInfo {
  startCursor: string | null
  endCursor: string | null
  hasPreviousPage: boolean
  hasNextPage: boolean
}

export interface ActivityPage {
  items: ActivityRow[]
  pageInfo: PageInfo
}

export type ActivityRefusal = 'INVALID_FILTER' | 'INVALID_CURSOR'

export type ActivityResult = { ok: true; page: ActivityPage } | { ok: false; code: ActivityRefusal }

const dayStart = (d: string) => new Date(`${d}T00:00:00.000Z`)
const nextDay = (d: string) => new Date(dayStart(d).getTime() + 24 * 60 * 60 * 1000)

/**
 * Entries in the caller's scope (LOGGING.md §6): the scope comes from the context, the filter
 * only narrows within it. Newest first, by keyset, never a total.
 */
export interface ActivityScope {
  /** Set for a Partner manager: only their assigned partners' entries (ACCESS.md §5.4, #60). */
  assignedTo?: string | undefined
}

export const listActivity = async (
  sql: postgres.Sql,
  context: CallerContext,
  filter: unknown,
  page: ActivityPageRequest,
  scope: ActivityScope = {},
): Promise<ActivityResult> => {
  const parsed = activityFilter.safeParse(filter ?? {})
  if (!parsed.success) return { ok: false, code: 'INVALID_FILTER' }
  const after = page.after ? decodeCursor(page.after) : undefined
  const before = page.before ? decodeCursor(page.before) : undefined
  if (after === null || before === null) return { ok: false, code: 'INVALID_CURSOR' }
  const limit = Math.min(Math.max(page.first ?? activityPageSize, 1), activityPageSize)

  const f = parsed.data
  const rows = await withScope(sql, context, (tx) =>
    selectActivity(
      tx,
      {
        actorKind: f.actorKind,
        actorId: f.actorId,
        targetType: f.targetType,
        targetId: f.targetId,
        partnerId: f.partnerId,
        storeId: f.storeId,
        customerId: f.customerId,
        action: f.action,
        from: f.from ? dayStart(f.from) : undefined,
        to: f.to ? nextDay(f.to) : undefined,
        assignedTo: scope.assignedTo,
        who: f.who,
        result: f.result,
        level: f.level,
        ip: f.ip,
        accessRef: f.accessRef,
        person: f.personKind && f.personId ? { kind: f.personKind, id: f.personId } : undefined,
      },
      { after, before },
      limit,
    ),
  )

  const more = rows.length > limit
  // Reading backwards, the extra row is the oldest one fetched, which sits first.
  const page_ = before ? rows.slice(more ? 1 : 0) : rows.slice(0, limit)
  // LOGGING.md §4: the address and user agent are shown to staff and to nobody outside DripFunnel.
  const staff = !isTenantContext(context) && !isPartnerContext(context)
  const items = staff ? page_ : page_.map((row) => ({ ...row, ip: null, user_agent: null }))
  const first = items[0]
  const last = items.at(-1)
  return {
    ok: true,
    page: {
      items,
      pageInfo: {
        startCursor: first ? encodeCursor({ occurredAt: first.occurred_at, id: first.id }) : null,
        endCursor: last ? encodeCursor({ occurredAt: last.occurred_at, id: last.id }) : null,
        hasPreviousPage: before ? more : after !== undefined,
        hasNextPage: before ? true : more,
      },
    },
  }
}
