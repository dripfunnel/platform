import { GraphQLError } from 'graphql'
import { pageOf } from '#core/paging'
import { createOffersService, offersAudit, type Action, type Condition, type OfferInput, type OfferKind, type OffersRefusal, type OffersResult, type OfferStatusFilter, type OfferView } from '#engine/modules/promotions/index'
import { allowanceFor, planLimitFor } from '#saas/entitlements/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { moneyInputType, moneyType, pageInfoType, type Money, type StoreBuilder } from './builder'
import { storePage } from './refusals'

// Offers (FIRST-RELEASE §8, §19; Offers and OfferEditor): the merchant side's alone. Owner and Manager write, Staff read
// (ACCESS §5.1); no supplier role holds an offers permission and the `store` scope refuses every supplier.

const words: Record<OffersRefusal, string> = {
  INVALID_INPUT: 'Something here isn’t valid.',
  NOT_FOUND: 'That offer isn’t here.',
  READ_ONLY: 'A read-only support session can’t change this store.',
  STALE_REVISION: 'Someone changed this offer since you opened it.',
  CODE_TAKEN: 'Another offer already uses that code.',
  UNKNOWN_TARGET: 'Something this offer names isn’t in your store any more.',
  CURRENCY_NOT_SOLD: 'Give amounts only in the currencies your store sells in.',
  PLAN_LIMIT: 'Your plan doesn’t include this.',
}

const statuses: readonly OfferStatusFilter[] = ['live', 'scheduled', 'off', 'ended']
const kinds: readonly OfferKind[] = ['products', 'order', 'bxgy', 'shipping']
const triggers = ['automatic', 'code'] as const

const moneyOf = (amounts: Readonly<Record<string, bigint>> | null | undefined): Money[] =>
  Object.entries(amounts ?? {}).map(([currency, amount]) => ({ currency, amount: amount.toString() }))

interface TargetsShape {
  productIds: string[]
  collectionIds: string[]
  filterValueIds: string[]
}
type ConditionShape = Partial<Record<string, unknown>> & { operation: string }

interface MoneyIn {
  currency: string
  amount: string
}
interface TargetsIn {
  productIds?: (string | number)[] | null | undefined
  collectionIds?: (string | number)[] | null | undefined
  filterValueIds?: (string | number)[] | null | undefined
}
interface ConditionIn {
  operation: string
  amounts?: MoneyIn[] | null | undefined
  minimum?: number | null | undefined
  productIds?: (string | number)[] | null | undefined
  collectionIds?: (string | number)[] | null | undefined
  filterValueIds?: (string | number)[] | null | undefined
  groupIds?: (string | number)[] | null | undefined
  customerIds?: (string | number)[] | null | undefined
  countries?: string[] | null | undefined
  days?: number[] | null | undefined
  from?: string | null | undefined
  to?: string | null | undefined
  conditions?: ConditionIn[] | null | undefined
}

/** A list of amounts as the engine takes them, one per currency; a currency given twice is refused, never collapsed. */
const amountsIn = (list: MoneyIn[] | null | undefined): Record<string, string> | undefined => {
  if (!list) return undefined
  const out: Record<string, string> = {}
  for (const m of list) {
    if (m.currency in out) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
    out[m.currency] = m.amount
  }
  return out
}
/** The flat GraphQL input as the engine's schema reads it: only the fields given, ids as strings. */
const compact = (o: Record<string, unknown>): Record<string, unknown> => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== null && v !== undefined))
const idsIn = (list: (string | number)[] | null | undefined) => list?.map(String)
const targetsIn = (t: TargetsIn | null | undefined) => (t ? compact({ productIds: idsIn(t.productIds), collectionIds: idsIn(t.collectionIds), filterValueIds: idsIn(t.filterValueIds) }) : t)
const conditionIn = (c: ConditionIn): Record<string, unknown> =>
  compact({
    ...c,
    amounts: amountsIn(c.amounts),
    productIds: idsIn(c.productIds),
    collectionIds: idsIn(c.collectionIds),
    filterValueIds: idsIn(c.filterValueIds),
    groupIds: idsIn(c.groupIds),
    customerIds: idsIn(c.customerIds),
    conditions: c.conditions?.map(conditionIn),
  })

export const registerOffers = (builder: StoreBuilder) => {
  const PageInfo = pageInfoType(builder)
  const MoneyType = moneyType(builder)
  const MoneyInput = moneyInputType(builder)

  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    const sql = ctx.sql
    const caller = actingCaller(ctx)
    return createOffersService({
      sql,
      context: caller.context,
      actor: { id: caller.person.id, partnerId: caller.person.partnerId },
      activity: ctx.activity,
      facts: ctx.facts,
      plan: {
        allows: async (key) => (await planLimitFor(sql, caller.context, { key }, ctx.now())) === null,
        liveAllowance: () => allowanceFor(sql, caller.context, 'live_offers', ctx.now()),
      },
      now: ctx.now,
    })
  }

  const answered = async <T>(ctx: StoreContext, result: OffersResult<T>): Promise<T> => {
    if (result.ok) return result.value
    if (result.reason === 'PLAN_LIMIT' && ctx.sql) {
      const check = result.key === 'live_offers' ? { key: result.key, total: result.wanted ?? 0 } : { key: result.key }
      const limit = await planLimitFor(ctx.sql, actingCaller(ctx).context, check, ctx.now())
      throw new GraphQLError(words.PLAN_LIMIT, { extensions: { code: 'PLAN_LIMIT', key: result.key, limit: limit?.limit ?? null, unlockedBy: limit?.unlockedBy ?? null } })
    }
    const facts = result.reason === 'STALE_REVISION' ? { revision: result.revision } : result.reason === 'CODE_TAKEN' ? { offerId: result.holder.offerId, name: result.holder.name, status: result.holder.status } : {}
    throw new GraphQLError(words[result.reason], { extensions: { code: result.reason, ...facts } })
  }

  const Targets = builder.objectRef<TargetsShape>('OfferTargets').implement({
    fields: (t) => ({ productIds: t.idList({ resolve: (x) => x.productIds }), collectionIds: t.idList({ resolve: (x) => x.collectionIds }), filterValueIds: t.idList({ resolve: (x) => x.filterValueIds }) }),
  })
  const Exclusions = builder.objectRef<{ giftCards: boolean; onSale: boolean }>('OfferExclusions').implement({
    fields: (t) => ({ giftCards: t.exposeBoolean('giftCards'), onSale: t.exposeBoolean('onSale') }),
  })
  const BuyGet = builder.objectRef<{ quantity: number; targets: TargetsShape | null }>('OfferBuyGet').implement({
    fields: (t) => ({ quantity: t.exposeInt('quantity'), targets: t.field({ type: Targets, nullable: true, resolve: (x) => x.targets }) }),
  })
  type Tier = Extract<Action, { operation: 'tiered_discount' }>['tiers'][number]
  const TierType = builder.objectRef<Tier>('OfferTier').implement({
    fields: (t) => ({
      minimum: t.field({ type: [MoneyType], resolve: (x) => moneyOf(x.minimum) }),
      percent: t.int({ nullable: true, resolve: (x) => x.percent ?? null }),
      amounts: t.field({ type: [MoneyType], resolve: (x) => moneyOf(x.amounts) }),
    }),
  })
  const field = <K extends string>(c: ConditionShape | Action, key: K): unknown => (c as Record<string, unknown>)[key]
  const ConditionType = builder.objectRef<Condition>('OfferCondition')
  ConditionType.implement({
    // The engine's operation keys (OFFERS-DESIGN §3.1), each with the arguments it takes; the others are empty.
    fields: (t) => ({
      operation: t.string({ resolve: (c) => c.operation }),
      amounts: t.field({ type: [MoneyType], resolve: (c) => moneyOf(field(c, 'amounts') as Record<string, bigint> | undefined) }),
      minimum: t.int({ nullable: true, resolve: (c) => (field(c, 'minimum') as number | undefined) ?? null }),
      productIds: t.idList({ resolve: (c) => (field(c, 'productIds') as string[] | undefined) ?? [] }),
      collectionIds: t.idList({ resolve: (c) => (field(c, 'collectionIds') as string[] | undefined) ?? [] }),
      filterValueIds: t.idList({ resolve: (c) => (field(c, 'filterValueIds') as string[] | undefined) ?? [] }),
      groupIds: t.idList({ resolve: (c) => (field(c, 'groupIds') as string[] | undefined) ?? [] }),
      customerIds: t.idList({ resolve: (c) => (field(c, 'customerIds') as string[] | undefined) ?? [] }),
      countries: t.stringList({ resolve: (c) => (field(c, 'countries') as string[] | undefined) ?? [] }),
      days: t.intList({ resolve: (c) => (field(c, 'days') as number[] | undefined) ?? [] }),
      from: t.string({ nullable: true, resolve: (c) => (field(c, 'from') as string | undefined) ?? null }),
      to: t.string({ nullable: true, resolve: (c) => (field(c, 'to') as string | undefined) ?? null }),
      conditions: t.field({ type: [ConditionType], resolve: (c) => (c.operation === 'any_of' ? c.conditions : []) }),
    }),
  })
  const ActionType = builder.objectRef<Action>('OfferAction').implement({
    fields: (t) => ({
      operation: t.string({ resolve: (a) => a.operation }),
      percent: t.int({ nullable: true, resolve: (a) => (field(a, 'percent') as number | undefined) ?? null }),
      amounts: t.field({ type: [MoneyType], resolve: (a) => moneyOf(field(a, 'amounts') as Record<string, bigint> | undefined) }),
      cap: t.field({ type: [MoneyType], resolve: (a) => moneyOf(field(a, 'cap') as Record<string, bigint> | null | undefined) }),
      targets: t.field({ type: Targets, nullable: true, resolve: (a) => (field(a, 'targets') as TargetsShape | undefined) ?? null }),
      exclude: t.field({ type: Exclusions, nullable: true, resolve: (a) => (field(a, 'exclude') as { giftCards: boolean; onSale: boolean } | undefined) ?? null }),
      buy: t.field({ type: BuyGet, nullable: true, resolve: (a) => (a.operation === 'buy_x_get_y' ? a.buy : null) }),
      get: t.field({ type: BuyGet, nullable: true, resolve: (a) => (a.operation === 'buy_x_get_y' ? a.get : null) }),
      oncePerOrder: t.boolean({ resolve: (a) => a.operation === 'buy_x_get_y' && a.oncePerOrder }),
      // percent or fixed, for a tiered offer
      kind: t.string({ nullable: true, resolve: (a) => (a.operation === 'tiered_discount' ? a.kind : null) }),
      tiers: t.field({ type: [TierType], resolve: (a) => (a.operation === 'tiered_discount' ? a.tiers : []) }),
    }),
  })
  const Combines = builder.objectRef<{ product: boolean; order: boolean; shipping: boolean }>('OfferCombines').implement({
    fields: (t) => ({ product: t.exposeBoolean('product'), order: t.exposeBoolean('order'), shipping: t.exposeBoolean('shipping') }),
  })
  const at = (d: Date | null) => (d ? new Date(d).toISOString() : null)
  const Offer = builder.objectRef<OfferView>('Offer').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      // Shown to shoppers on the cart, receipt and invoice (OFFERS fact 13).
      name: t.exposeString('name'),
      internalName: t.exposeString('internal_name', { nullable: true }),
      description: t.exposeString('description', { nullable: true }),
      // automatic or code
      trigger: t.exposeString('trigger'),
      code: t.exposeString('code', { nullable: true }),
      // live, scheduled, off, ended or used_up; "ending soon" is the portal's reading of endsAt
      status: t.exposeString('status'),
      enabled: t.exposeBoolean('enabled'),
      startsAt: t.string({ nullable: true, resolve: (o) => at(o.starts_at) }),
      endsAt: t.string({ nullable: true, resolve: (o) => at(o.ends_at) }),
      totalUsesLimit: t.exposeInt('total_uses_limit', { nullable: true }),
      perCustomerLimit: t.exposeInt('per_customer_limit', { nullable: true }),
      usesCount: t.exposeInt('uses_count'),
      combines: t.field({ type: Combines, resolve: (o) => o.combines_with }),
      conditions: t.field({ type: [ConditionType], resolve: (o) => o.conditions }),
      action: t.field({ type: ActionType, resolve: (o) => o.action }),
      revision: t.exposeInt('revision'),
      createdAt: t.string({ resolve: (o) => new Date(o.created_at).toISOString() }),
      updatedAt: t.string({ resolve: (o) => new Date(o.updated_at).toISOString() }),
    }),
  })
  const OfferPage = builder.objectRef<{ nodes: OfferView[]; pageInfo: { startCursor: string | null; endCursor: string | null; hasPreviousPage: boolean; hasNextPage: boolean } }>('OfferPage').implement({
    fields: (t) => ({ nodes: t.field({ type: [Offer], resolve: (p) => p.nodes }), pageInfo: t.field({ type: PageInfo, resolve: (p) => p.pageInfo }) }),
  })
  const Counts = builder.objectRef<Record<OfferStatusFilter, number>>('OfferCounts').implement({
    fields: (t) => ({ live: t.exposeInt('live'), scheduled: t.exposeInt('scheduled'), off: t.exposeInt('off'), ended: t.exposeInt('ended') }),
  })
  const Saved = builder.objectRef<{ id: string; revision: number }>('SavedOffer').implement({ fields: (t) => ({ id: t.exposeID('id'), revision: t.exposeInt('revision') }) })

  const TargetsInput = builder.inputType('OfferTargetsInput', { fields: (t) => ({ productIds: t.idList(), collectionIds: t.idList(), filterValueIds: t.idList() }) })
  const ExclusionsInput = builder.inputType('OfferExclusionsInput', { fields: (t) => ({ giftCards: t.boolean(), onSale: t.boolean() }) })
  const BuyGetInput = builder.inputType('OfferBuyGetInput', { fields: (t) => ({ quantity: t.int({ required: true }), targets: t.field({ type: TargetsInput }) }) })
  const TierInput = builder.inputType('OfferTierInput', { fields: (t) => ({ minimum: t.field({ type: [MoneyInput], required: true }), percent: t.int(), amounts: t.field({ type: [MoneyInput] }) }) })
  const ConditionInput = builder.inputRef<ConditionIn>('OfferConditionInput')
  ConditionInput.implement({
    fields: (t) => ({
      operation: t.string({ required: true }),
      amounts: t.field({ type: [MoneyInput] }),
      minimum: t.int(),
      productIds: t.idList(),
      collectionIds: t.idList(),
      filterValueIds: t.idList(),
      groupIds: t.idList(),
      customerIds: t.idList(),
      countries: t.stringList(),
      days: t.intList(),
      from: t.string(),
      to: t.string(),
      conditions: t.field({ type: [ConditionInput] }),
    }),
  })
  const ActionInput = builder.inputType('OfferActionInput', {
    fields: (t) => ({
      operation: t.string({ required: true }),
      percent: t.int(),
      amounts: t.field({ type: [MoneyInput] }),
      cap: t.field({ type: [MoneyInput] }),
      targets: t.field({ type: TargetsInput }),
      exclude: t.field({ type: ExclusionsInput }),
      buy: t.field({ type: BuyGetInput }),
      get: t.field({ type: BuyGetInput }),
      oncePerOrder: t.boolean(),
      kind: t.string(),
      tiers: t.field({ type: [TierInput] }),
    }),
  })
  const CombinesInput = builder.inputType('OfferCombinesInput', { fields: (t) => ({ product: t.boolean({ required: true }), order: t.boolean({ required: true }), shipping: t.boolean({ required: true }) }) })
  const OfferInputType = builder.inputType('OfferInput', {
    fields: (t) => ({
      name: t.string({ required: true }),
      internalName: t.string(),
      description: t.string(),
      trigger: t.string({ required: true }),
      code: t.string(),
      // On and no start date is live at once: the editor's Start now; on with a start is Schedule; off is Keep off (#337).
      enabled: t.boolean({ required: true }),
      startsAt: t.string(),
      endsAt: t.string(),
      totalUsesLimit: t.int(),
      perCustomerLimit: t.int(),
      combines: t.field({ type: CombinesInput, required: true }),
      conditions: t.field({ type: [ConditionInput], required: true }),
      action: t.field({ type: ActionInput, required: true }),
    }),
  })

  const instant = (value: string | null | undefined): Date | null => {
    if (value === null || value === undefined || value === '') return null
    const d = new Date(value)
    if (Number.isNaN(d.getTime()) || !/[zZ]|[+-]\d\d:\d\d$/.test(value)) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
    return d
  }

  const read = { api: 'store', scope: 'store', permission: 'offers.read', target: 'none' } as const
  const write = (audit: string) => ({ api: 'store', scope: 'store', permission: 'offers.write', target: 'none', audit }) as const

  builder.queryFields((t) => ({
    offers: t.field({
      type: OfferPage,
      args: { status: t.arg.string(), kind: t.arg.string(), trigger: t.arg.string(), search: t.arg.string(), first: t.arg.int(), after: t.arg.string(), before: t.arg.string() },
      extensions: { access: read },
      resolve: async (_, args, ctx) => {
        const status = args.status ? (statuses.find((s) => s === args.status) ?? false) : null
        const kind = args.kind ? (kinds.find((k) => k === args.kind) ?? false) : null
        const trigger = args.trigger ? (triggers.find((k) => k === args.trigger) ?? false) : null
        if (status === false || kind === false || trigger === false) throw new GraphQLError(words.INVALID_INPUT, { extensions: { code: 'INVALID_INPUT' } })
        const window = storePage(args)
        return pageOf(await service(ctx).list({ status, kind, trigger, search: args.search ?? null }, window), window, (o) => ({ occurredAt: new Date(o.created_at), id: o.id }))
      },
    }),
    // The tabs' counts (B1): Used up counts as Ended.
    offerCounts: t.field({ type: Counts, extensions: { access: read }, resolve: (_, __, ctx) => service(ctx).tabCounts() }),
    offer: t.field({ type: Offer, nullable: true, args: { id: t.arg.id({ required: true }) }, extensions: { access: read }, resolve: (_, args, ctx) => service(ctx).detail(String(args.id)) }),
  }))

  builder.mutationFields((t) => ({
    // A new offer without `id`; an edit names the revision it was read at.
    saveOffer: t.field({
      type: Saved,
      args: { id: t.arg.id(), revision: t.arg.int(), input: t.arg({ type: OfferInputType, required: true }) },
      extensions: { access: write(offersAudit.updated) },
      resolve: async (_, args, ctx) => {
        const i = args.input
        const input = {
          name: i.name,
          internalName: i.internalName ?? null,
          description: i.description ?? null,
          trigger: i.trigger,
          code: i.code ?? null,
          enabled: i.enabled,
          startsAt: instant(i.startsAt),
          endsAt: instant(i.endsAt),
          totalUsesLimit: i.totalUsesLimit ?? null,
          perCustomerLimit: i.perCustomerLimit ?? null,
          combines: i.combines,
          conditions: i.conditions.map(conditionIn),
          action: compact({
            ...i.action,
            amounts: amountsIn(i.action.amounts),
            cap: amountsIn(i.action.cap),
            targets: targetsIn(i.action.targets),
            exclude: i.action.exclude ? compact(i.action.exclude) : undefined,
            buy: i.action.buy ? compact({ ...i.action.buy, targets: targetsIn(i.action.buy.targets) }) : undefined,
            get: i.action.get ? compact({ ...i.action.get, targets: targetsIn(i.action.get.targets) }) : undefined,
            tiers: i.action.tiers?.map((tier) => compact({ minimum: amountsIn(tier.minimum), percent: tier.percent, amounts: amountsIn(tier.amounts) })),
          }),
        } as unknown as OfferInput
        return answered(ctx, await service(ctx).save(args.id ? String(args.id) : null, args.revision ?? null, input))
      },
    }),
    // "Turn off" (N2): carts in progress lose it the next time they are priced (fact 16).
    pauseOffer: t.boolean({ args: { id: t.arg.id({ required: true }) }, extensions: { access: write(offersAudit.paused) }, resolve: async (_, args, ctx) => answered(ctx, await service(ctx).pause(String(args.id))) }),
    resumeOffer: t.boolean({ args: { id: t.arg.id({ required: true }) }, extensions: { access: write(offersAudit.resumed) }, resolve: async (_, args, ctx) => answered(ctx, await service(ctx).resume(String(args.id))) }),
    endOffer: t.boolean({ args: { id: t.arg.id({ required: true }) }, extensions: { access: write(offersAudit.ended) }, resolve: async (_, args, ctx) => answered(ctx, await service(ctx).end(String(args.id))) }),
    duplicateOffer: t.id({ args: { id: t.arg.id({ required: true }) }, extensions: { access: write(offersAudit.duplicated) }, resolve: async (_, args, ctx) => answered(ctx, await service(ctx).duplicate(String(args.id))) }),
    deleteOffer: t.boolean({ args: { id: t.arg.id({ required: true }) }, extensions: { access: write(offersAudit.deleted) }, resolve: async (_, args, ctx) => answered(ctx, await service(ctx).remove(String(args.id))) }),
  }))
}
