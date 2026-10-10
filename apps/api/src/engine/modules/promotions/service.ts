import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { serialise, withScope, type ScopedSql } from '#db/scoped/index'
import {
  countKnownIds,
  countOffers,
  countOnOffers,
  insertOffer,
  lockOffer,
  replaceRules,
  selectCodeOwner,
  selectOffer,
  selectOffers,
  selectStoreCurrencies,
  setOfferState,
  setSharedCode,
  updateOffer,
  type OfferFilter,
  type OfferRow,
  type OfferStatusFilter,
  type OfferWrite,
} from '#db/scoped/promotions'
import { namedIds, needsGroupOffers, offerSchema, parseAction, parseCondition, statusOf, toStored, type Action, type Condition, type OfferDefinition, type OfferInput, type OfferStatus } from './definition'

// Offers on the merchant side (FIRST-RELEASE §8; OFFERS-DESIGN parts B–N): in the caller's own store scope, so row security
// keeps every other store and every supplier out. Plan gates are checked here, at the write (SAAS §6.2).

export type { OfferFilter, OfferKind, OfferStatusFilter } from '#db/scoped/promotions'

export const offersAudit = {
  created: 'offer.created',
  updated: 'offer.updated',
  paused: 'offer.paused',
  resumed: 'offer.resumed',
  ended: 'offer.ended',
  duplicated: 'offer.duplicated',
  deleted: 'offer.deleted',
} as const

export type OfferPlanKey = 'offers' | 'group_offers' | 'live_offers'

export type OffersRefusal = 'INVALID_INPUT' | 'NOT_FOUND' | 'READ_ONLY' | 'STALE_REVISION' | 'CODE_TAKEN' | 'UNKNOWN_TARGET' | 'CURRENCY_NOT_SOLD' | 'PLAN_LIMIT'

/** Who holds a code already, so the editor can say which offer and in which state (H2). */
export interface CodeHolder {
  offerId: string
  name: string
  status: OfferStatus | 'deleted'
}

export type OffersResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: Exclude<OffersRefusal, 'STALE_REVISION' | 'CODE_TAKEN' | 'PLAN_LIMIT'> }
  | { ok: false; reason: 'STALE_REVISION'; revision: number }
  | { ok: false; reason: 'CODE_TAKEN'; holder: CodeHolder }
  | { ok: false; reason: 'PLAN_LIMIT'; key: OfferPlanKey; wanted: number | null }

type Refusal = Extract<OffersResult<never>, { ok: false }>

class Refused extends Error {
  constructor(readonly refusal: Refusal) {
    super(refusal.reason)
  }
}

export interface OffersPlan {
  /** Whether the store's plan switches this on (saas/entitlements). */
  allows: (key: 'offers' | 'group_offers') => Promise<boolean>
  /** The live-offer limit, read before the locked count. */
  liveAllowance: () => Promise<number>
}

export interface OffersDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  plan: OffersPlan
  now: () => Date
}

export interface OfferView extends Omit<OfferRow, 'conditions' | 'action'> {
  status: OfferStatus
  conditions: Condition[]
  action: Action
}

const viewOf = (row: OfferRow, now: Date): OfferView => {
  // Every stored rule went through the same schema on its way in; one that no longer parses is a bug, not a shopper's input.
  const conditions = row.conditions.map((c) => parseCondition({ operation: c.operation, ...c.args }))
  const action = row.action ? parseAction({ operation: row.action.operation, ...row.action.args }) : null
  if (!action || conditions.some((c) => c === null)) throw new Error(`promotion ${row.id}: a stored rule doesn't parse`)
  return { ...row, conditions: conditions as Condition[], action, status: statusOf({ enabled: row.enabled, startsAt: row.starts_at, endsAt: row.ends_at, usesCount: row.uses_count, totalUsesLimit: row.total_uses_limit }, now) }
}

const counts = (o: { enabled: boolean; ends_at: Date | null; uses_count: number; total_uses_limit: number | null }, now: Date) =>
  o.enabled && (o.ends_at === null || o.ends_at > now) && (o.total_uses_limit === null || o.uses_count < o.total_uses_limit)

const amountCurrencies = (d: Pick<OfferDefinition, 'conditions' | 'action'>): string[] => {
  const found = new Set<string>()
  JSON.stringify([d.conditions, d.action], (key, value: unknown) => {
    if ((key === 'amounts' || key === 'cap' || key === 'minimum') && value && typeof value === 'object') Object.keys(value).forEach((c) => found.add(c))
    return typeof value === 'bigint' ? value.toString() : value
  })
  return [...found]
}

export const createOffersService = ({ sql, context, actor, activity, facts, plan, now }: OffersDeps) => {
  const { storeId } = context
  const supplier = context.sellerScope.kind === 'seller'
  const readOnly = context.caller.kind === 'support' && context.caller.access === 'read'

  const entry = (action: string, offer: { id: string; name: string }, changes: ActivityEntry['changes'] = []): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target: { type: 'offer', id: offer.id, label: offer.name },
    reason: null,
    changes,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const read = <T>(work: (tx: ScopedSql) => Promise<T>, empty: T): Promise<T> => (supplier ? Promise.resolve(empty) : withScope(sql, context, work))
  const write = async <T>(work: (tx: ScopedSql) => Promise<T>): Promise<OffersResult<T>> => {
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    try {
      return { ok: true, value: await withScope(sql, context, work) }
    } catch (error) {
      if (error instanceof Refused) return error.refusal
      throw error
    }
  }
  const locked = async (tx: ScopedSql, id: string) => {
    const found = isUuid(id) ? await lockOffer(tx, storeId, id) : null
    if (!found) throw new Refused({ ok: false, reason: 'NOT_FOUND' })
    return found
  }
  const requireSwitch = async (key: 'offers' | 'group_offers') => {
    if (!(await plan.allows(key))) throw new Refused({ ok: false, reason: 'PLAN_LIMIT', key, wanted: null })
  }
  /** Counted under the store's lock after the write, so two saves can't both take the last live place (AGENTS.md "Reliability"). */
  const holdLiveLimit = async (tx: ScopedSql, allowance: number) => {
    await serialise(tx, `offers:live:${storeId}`)
    const live = await countOnOffers(tx, storeId, now())
    if (live > allowance) throw new Refused({ ok: false, reason: 'PLAN_LIMIT', key: 'live_offers', wanted: live })
  }

  const list = (filter: OfferFilter, window: PageWindow): Promise<OfferView[]> => {
    const search = filter.search?.trim().slice(0, 100) || null
    return read(async (tx) => (await selectOffers(tx, storeId, { ...filter, search }, window, now())).map((r) => viewOf(r, now())), [])
  }
  const tabCounts = (): Promise<Record<OfferStatusFilter, number>> => read((tx) => countOffers(tx, storeId, now()), { live: 0, scheduled: 0, off: 0, ended: 0 })
  const detail = (id: string): Promise<OfferView | null> =>
    isUuid(id)
      ? read(async (tx) => {
          const row = await selectOffer(tx, storeId, id.toLowerCase())
          return row ? viewOf(row, now()) : null
        }, null)
      : Promise.resolve(null)

  const writeOf = (d: OfferDefinition): OfferWrite => ({
    name: d.name,
    internalName: d.internalName,
    description: d.description,
    trigger: d.trigger,
    enabled: d.enabled,
    startsAt: d.startsAt,
    endsAt: d.endsAt,
    totalUsesLimit: d.totalUsesLimit,
    perCustomerLimit: d.perCustomerLimit,
    combines: d.combines,
  })
  const rulesOf = (d: Pick<OfferDefinition, 'conditions' | 'action'>) => {
    const split = ({ operation, ...args }: Condition | Action) => ({ operation, args: toStored(args as Condition) })
    return { conditions: d.conditions.map(split), action: split(d.action) }
  }

  const statusOfHolder = async (tx: ScopedSql, code: string, id: string | null) => {
    const holder = await selectCodeOwner(tx, storeId, code)
    if (!holder || holder.promotion_id === id) return
    const status = holder.deleted ? ('deleted' as const) : statusOf({ enabled: holder.enabled, startsAt: holder.starts_at, endsAt: holder.ends_at, usesCount: holder.uses_count, totalUsesLimit: holder.total_uses_limit }, now())
    throw new Refused({ ok: false, reason: 'CODE_TAKEN', holder: { offerId: holder.promotion_id, name: holder.name, status } })
  }

  /** "Save" (OfferEditor): a new offer when `id` is null, else the one read at `revision`; nothing is a draft (#337). */
  const save = async (id: string | null, revision: number | null, input: OfferInput): Promise<OffersResult<{ id: string; revision: number }>> => {
    const parsed = offerSchema.safeParse(input)
    if (!parsed.success || (id !== null && (!isUuid(id) || revision === null))) return { ok: false, reason: 'INVALID_INPUT' }
    const d = parsed.data
    if (supplier) return { ok: false, reason: 'NOT_FOUND' }
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    const allowance = d.enabled ? await plan.liveAllowance() : 0
    return write(async (tx) => {
      const before = id ? await locked(tx, id.toLowerCase()) : null
      if (before && before.revision !== revision) throw new Refused({ ok: false, reason: 'STALE_REVISION', revision: before.revision })
      if (!before) await requireSwitch('offers')
      if (needsGroupOffers(d) && !(before && needsGroupOffers(viewOf(before, now())))) await requireSwitch('group_offers')
      const sold = await selectStoreCurrencies(tx, storeId)
      if (!amountCurrencies(d).every((c) => sold.includes(c))) throw new Refused({ ok: false, reason: 'CURRENCY_NOT_SOLD' })
      const named = namedIds(d)
      const total = Object.values(named).reduce((n, list) => n + list.length, 0)
      if ((await countKnownIds(tx, storeId, named)) !== total) throw new Refused({ ok: false, reason: 'UNKNOWN_TARGET' })
      if (d.code) await statusOfHolder(tx, d.code, before?.id ?? null)
      const offerId = before ? before.id : await insertOffer(tx, storeId, writeOf(d), actor.id)
      const saved = before ? await updateOffer(tx, before.id, writeOf(d), now()) : 1
      const rules = rulesOf(d)
      await replaceRules(tx, storeId, offerId, rules.conditions, rules.action)
      await setSharedCode(tx, storeId, offerId, d.trigger === 'code' ? d.code : null, now())
      const usesCount = before?.uses_count ?? 0
      if (counts({ enabled: d.enabled, ends_at: d.endsAt, uses_count: usesCount, total_uses_limit: d.totalUsesLimit }, now()) && !(before && counts(before, now()))) await holdLiveLimit(tx, allowance)
      const time = (d?: Date | null) => d?.getTime() ?? null
      const pairs: [string, unknown, unknown][] = before
        ? [['name', before.name, d.name], ['enabled', before.enabled, d.enabled], ['starts_at', time(before.starts_at), time(d.startsAt)], ['ends_at', time(before.ends_at), time(d.endsAt)],
           ['total_uses_limit', before.total_uses_limit, d.totalUsesLimit], ['per_customer_limit', before.per_customer_limit, d.perCustomerLimit], ['code', before.code, d.trigger === 'code' ? d.code : null]]
        : []
      const changed = pairs.filter(([, a, b]) => a !== b).map(([field]) => field)
      await activity.record(tx, entry(before ? offersAudit.updated : offersAudit.created, { id: offerId, name: d.name }, changed.map((field) => ({ field, before: null, after: 'changed' }))))
      return { id: offerId, revision: saved }
    })
  }

  const turn = async (id: string, on: boolean): Promise<OffersResult<true>> => {
    const allowance = on ? await plan.liveAllowance() : 0
    return write(async (tx) => {
      const found = await locked(tx, id.toLowerCase())
      if (found.enabled === on) return true as const
      if (on) await requireSwitch('offers')
      await setOfferState(tx, found.id, { enabled: on }, now())
      if (on && counts({ ...found, enabled: true }, now())) await holdLiveLimit(tx, allowance)
      await activity.record(tx, entry(on ? offersAudit.resumed : offersAudit.paused, found, [{ field: 'enabled', before: String(found.enabled), after: String(on) }]))
      return true as const
    })
  }

  /** "End now" (N3): its end date becomes now; unlike Off, meant to be final. */
  const end = (id: string): Promise<OffersResult<true>> =>
    write(async (tx) => {
      const found = await locked(tx, id.toLowerCase())
      if (found.ends_at && found.ends_at <= now()) return true as const
      await setOfferState(tx, found.id, { endNow: now() }, now())
      await activity.record(tx, entry(offersAudit.ended, found))
      return true as const
    })

  /** "Duplicate" (N4): a copy, Off, with no code and no uses. */
  const duplicate = async (id: string): Promise<OffersResult<string>> =>
    write(async (tx) => {
      const found = viewOf(await locked(tx, id.toLowerCase()), now())
      await requireSwitch('offers')
      if (needsGroupOffers(found)) await requireSwitch('group_offers')
      const name = `Copy of ${found.name}`.slice(0, 120)
      const copy = await insertOffer(
        tx,
        storeId,
        { name, internalName: found.internal_name, description: found.description, trigger: found.trigger, enabled: false, startsAt: found.starts_at, endsAt: found.ends_at, totalUsesLimit: found.total_uses_limit, perCustomerLimit: found.per_customer_limit, combines: found.combines_with },
        actor.id,
      )
      const rules = rulesOf(found)
      await replaceRules(tx, storeId, copy, rules.conditions, rules.action)
      await activity.record(tx, entry(offersAudit.duplicated, { id: copy, name }, [{ field: 'from', before: null, after: found.id }]))
      return copy
    })

  /** Soft: past orders keep their discount, and its codes stay this offer's (fact 14). */
  const remove = (id: string): Promise<OffersResult<true>> =>
    write(async (tx) => {
      const found = await locked(tx, id.toLowerCase())
      await setOfferState(tx, found.id, { deletedAt: now() }, now())
      await activity.record(tx, entry(offersAudit.deleted, found))
      return true as const
    })

  return { list, tabCounts, detail, save, pause: (id: string) => turn(id, false), resume: (id: string) => turn(id, true), end, duplicate, remove }
}
