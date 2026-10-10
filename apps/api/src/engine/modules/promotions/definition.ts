import { z } from 'zod'
import { isCountry } from '#core/countries'
import { isUuid } from '#core/ids'
import { isCurrency, parseMinor } from '#core/money'

// An offer as the engine holds it (OFFERS-DESIGN §3 facts 1–7): a name, conditions that all hold (one of them may be
// `any_of`), one action, how shoppers get it, dates, limits and what it combines with. Every rule here is platform-defined
// (PLATFORM-PROMPT §5.10); a merchant only fills in the arguments.

const maxTargetIds = 250
export const maxConditions = 20

const uuid = z
  .string()
  .transform((s) => s.trim().toLowerCase())
  .refine(isUuid, 'not an id')
const ids = z
  .array(uuid)
  .max(maxTargetIds)
  .transform((list) => [...new Set(list)])
const count = z.number().int().min(1).max(999)
const percent = z.number().int().min(1).max(100)

/** One amount per currency the store sells in, minor units as strings (fact 10): never one integer read as every currency's. */
const amountsSchema = z.record(z.string(), z.string()).transform((raw, ctx) => {
  const out: Record<string, bigint> = {}
  for (const [currency, value] of Object.entries(raw)) {
    const money = isCurrency(currency) ? parseMinor(value, currency) : null
    if (!money || money.amount === 0n) {
      ctx.addIssue({ code: 'custom', message: `amount in ${currency}` })
      return z.NEVER
    }
    out[currency] = money.amount
  }
  if (Object.keys(out).length === 0 || Object.keys(out).length > 20) {
    ctx.addIssue({ code: 'custom', message: 'amounts' })
    return z.NEVER
  }
  return out
})
export type Amounts = Readonly<Record<string, bigint>>

/** Products, collections and filter values, any of them; picking a product means every version, now and later (fact 5). */
const targetsSchema = z
  .object({ productIds: ids.default([]), collectionIds: ids.default([]), filterValueIds: ids.default([]) })
  .strict()
  .refine((t) => t.productIds.length + t.collectionIds.length + t.filterValueIds.length > 0, 'no targets')
export type Targets = z.output<typeof targetsSchema>

const excludeSchema = z.object({ giftCards: z.boolean().default(false), onSale: z.boolean().default(false) }).strict()

const clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/)
const minutesOf = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5))

const leafConditions = [
  z.object({ operation: z.literal('minimum_order_amount'), amounts: amountsSchema }).strict(),
  z.object({ operation: z.literal('minimum_quantity'), minimum: count }).strict(),
  z.object({ operation: z.literal('contains_products'), minimum: count, productIds: ids.refine((l) => l.length > 0) }).strict(),
  z.object({ operation: z.literal('at_least_n_with_filter_values'), minimum: count, filterValueIds: ids.refine((l) => l.length > 0) }).strict(),
  z.object({ operation: z.literal('contains_collection'), minimum: count, collectionIds: ids.refine((l) => l.length > 0) }).strict(),
  z.object({ operation: z.literal('customer_group'), groupIds: ids.refine((l) => l.length > 0) }).strict(),
  z.object({ operation: z.literal('specific_customers'), customerIds: ids.refine((l) => l.length > 0) }).strict(),
  z.object({ operation: z.literal('first_order') }).strict(),
  z
    .object({ operation: z.literal('shipping_country'), countries: z.array(z.string().transform((c) => c.trim().toUpperCase())).min(1).max(250) })
    .strict()
    .refine((c) => c.countries.every(isCountry), 'country'),
  // OfferEditor's "repeat": these days, between these times, in the store's time zone.
  z
    .object({ operation: z.literal('recurrence'), days: z.array(z.number().int().min(0).max(6)).min(1).max(7), from: clock, to: clock })
    .strict()
    .refine((r) => new Set(r.days).size === r.days.length && minutesOf(r.from) < minutesOf(r.to), 'window'),
] as const
const leafSchema = z.union(leafConditions)
export type LeafCondition = z.output<typeof leafSchema>

/** AND across an offer's conditions; `any_of` is the engine's OR, which the portal's form doesn't offer (fact 2, #337). */
const conditionSchema = z.union([...leafConditions, z.object({ operation: z.literal('any_of'), conditions: z.array(leafSchema).min(2).max(10) }).strict()])
export type Condition = z.output<typeof conditionSchema>
export type ConditionOperation = Condition['operation']

const tierSchema = z.object({ minimum: amountsSchema, percent: percent.optional(), amounts: amountsSchema.optional() }).strict()

const actionSchema = z.union([
  z.object({ operation: z.literal('order_percentage_discount'), percent, cap: amountsSchema.nullable().default(null) }).strict(),
  z.object({ operation: z.literal('order_fixed_discount'), amounts: amountsSchema }).strict(),
  z.object({ operation: z.literal('products_percentage_discount'), percent, targets: targetsSchema, exclude: excludeSchema.default({ giftCards: false, onSale: false }), cap: amountsSchema.nullable().default(null) }).strict(),
  // Per unit (#337): 2 × a T-shirt at 5 off is 10 off.
  z.object({ operation: z.literal('line_fixed_discount'), amounts: amountsSchema, targets: targetsSchema, exclude: excludeSchema.default({ giftCards: false, onSale: false }) }).strict(),
  z.object({ operation: z.literal('free_shipping') }).strict(),
  z.object({ operation: z.literal('shipping_fixed_discount'), amounts: amountsSchema }).strict(),
  // The cheapest qualifying units are discounted, once per set bought unless `oncePerOrder` (#337); `get.targets` null is "the same".
  z
    .object({
      operation: z.literal('buy_x_get_y'),
      buy: z.object({ quantity: z.number().int().min(1).max(99), targets: targetsSchema }).strict(),
      get: z.object({ quantity: z.number().int().min(1).max(99), targets: targetsSchema.nullable().default(null) }).strict(),
      percent: percent.default(100),
      oncePerOrder: z.boolean().default(false),
    })
    .strict(),
  z
    .object({ operation: z.literal('tiered_discount'), kind: z.enum(['percent', 'fixed']), tiers: z.array(tierSchema).min(2).max(5) })
    .strict()
    .refine((t) => t.tiers.every((tier) => (t.kind === 'percent' ? tier.percent !== undefined && !tier.amounts : tier.amounts !== undefined && tier.percent === undefined)), 'tiers'),
])
export type Action = z.output<typeof actionSchema>
export type ActionOperation = Action['operation']

export const combinesSchema = z.object({ product: z.boolean(), order: z.boolean(), shipping: z.boolean() }).strict()
export type Combines = z.output<typeof combinesSchema>

export type OfferClass = keyof Combines

/** Which stage of the fixed order the action runs in: product discounts, then order, then shipping (fact 7, #337). */
export const classOf = (action: Action): OfferClass => {
  switch (action.operation) {
    case 'products_percentage_discount':
    case 'line_fixed_discount':
    case 'buy_x_get_y':
      return 'product'
    case 'free_shipping':
    case 'shipping_fixed_discount':
      return 'shipping'
    default:
      return 'order'
  }
}

/** Codes are saved uppercase and matched case-insensitively (#337); letters, digits, - and _ only. */
export const normaliseCode = (raw: string): string | null => {
  const code = raw.trim().toUpperCase()
  return /^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code) ? code : null
}

const text = (max: number) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s.length <= max)
const optionalText = (max: number) =>
  z
    .string()
    .nullable()
    .transform((s) => s?.trim() || null)
    .refine((s) => (s?.length ?? 0) <= max)

export const offerSchema = z
  .object({
    name: text(120).refine((s) => s.length > 0),
    internalName: optionalText(120),
    description: optionalText(500),
    trigger: z.enum(['automatic', 'code']),
    /** The shared code; a code offer may instead hand out single-use codes (generateCodes). */
    code: z
      .string()
      .nullable()
      .transform((c, ctx) => {
        if (c === null || c.trim() === '') return null
        const code = normaliseCode(c)
        if (!code) {
          ctx.addIssue({ code: 'custom', message: 'code' })
          return z.NEVER
        }
        return code
      }),
    enabled: z.boolean(),
    startsAt: z.date().nullable(),
    endsAt: z.date().nullable(),
    totalUsesLimit: z.number().int().min(1).max(100_000_000).nullable(),
    perCustomerLimit: z.number().int().min(1).max(1000).nullable(),
    combines: combinesSchema,
    conditions: z.array(conditionSchema).max(maxConditions),
    action: actionSchema,
  })
  .strict()
  .refine((o) => !(o.startsAt && o.endsAt) || o.endsAt > o.startsAt, 'dates')
  .refine((o) => o.trigger === 'code' || o.code === null, 'code')
export type OfferDefinition = z.output<typeof offerSchema>
export type OfferInput = z.input<typeof offerSchema>

export const parseCondition = (raw: unknown): Condition | null => {
  const parsed = conditionSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}
export const parseAction = (raw: unknown): Action | null => {
  const parsed = actionSchema.safeParse(raw)
  return parsed.success ? parsed.data : null
}

/** The stored form of an argument object: amounts as strings of minor units, as the API carries them. */
export const toStored = (value: Condition | Action): Record<string, unknown> => JSON.parse(JSON.stringify(value, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as Record<string, unknown>

const allConditions = (conditions: readonly Condition[]): LeafCondition[] => conditions.flatMap((c) => (c.operation === 'any_of' ? c.conditions : [c]))

/** The plan's "customer-group offers, tiers, single-use codes" switch (designs/DF Store Pricing; SAAS §6.1). */
export const needsGroupOffers = (o: Pick<OfferDefinition, 'conditions' | 'action'>): boolean =>
  o.action.operation === 'tiered_discount' || allConditions(o.conditions).some((c) => c.operation === 'customer_group' || c.operation === 'specific_customers')

/** Ids an offer names, by kind, so the service can check each is this store's before saving. */
export const namedIds = (o: Pick<OfferDefinition, 'conditions' | 'action'>) => {
  const products = new Set<string>()
  const collections = new Set<string>()
  const filterValues = new Set<string>()
  const groups = new Set<string>()
  const customers = new Set<string>()
  const addTargets = (t: Targets | null) => {
    t?.productIds.forEach((x) => products.add(x))
    t?.collectionIds.forEach((x) => collections.add(x))
    t?.filterValueIds.forEach((x) => filterValues.add(x))
  }
  for (const c of allConditions(o.conditions)) {
    if (c.operation === 'contains_products') c.productIds.forEach((x) => products.add(x))
    if (c.operation === 'contains_collection') c.collectionIds.forEach((x) => collections.add(x))
    if (c.operation === 'at_least_n_with_filter_values') c.filterValueIds.forEach((x) => filterValues.add(x))
    if (c.operation === 'customer_group') c.groupIds.forEach((x) => groups.add(x))
    if (c.operation === 'specific_customers') c.customerIds.forEach((x) => customers.add(x))
  }
  const a = o.action
  if (a.operation === 'products_percentage_discount' || a.operation === 'line_fixed_discount') addTargets(a.targets)
  if (a.operation === 'buy_x_get_y') {
    addTargets(a.buy.targets)
    addTargets(a.get.targets)
  }
  return { products: [...products], collections: [...collections], filterValues: [...filterValues], groups: [...groups], customers: [...customers] }
}

export type OfferStatus = 'live' | 'scheduled' | 'off' | 'ended' | 'used_up'

/** Derived, never stored (fact 9): off, then ended, then used up, then scheduled. A repeating offer is live between its windows. */
export const statusOf = (o: { enabled: boolean; startsAt: Date | null; endsAt: Date | null; usesCount: number; totalUsesLimit: number | null }, now: Date): OfferStatus => {
  if (!o.enabled) return 'off'
  if (o.endsAt && o.endsAt <= now) return 'ended'
  if (o.totalUsesLimit !== null && o.usesCount >= o.totalUsesLimit) return 'used_up'
  if (o.startsAt && o.startsAt > now) return 'scheduled'
  return 'live'
}

export interface LocalTime {
  /** 0 is Sunday, as the recurrence's days are. */
  day: number
  minutes: number
}

const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

/** The store's own day and time of day, for a repeating offer's window (fact 9: dates are the store's time zone's). */
export const localTimeIn = (now: Date, timeZone: string): LocalTime => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now)
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return { day: Math.max(weekdays.indexOf(part('weekday')), 0), minutes: Number(part('hour')) * 60 + Number(part('minute')) }
}

export const inWindow = (r: Extract<LeafCondition, { operation: 'recurrence' }>, at: LocalTime): boolean => r.days.includes(at.day) && at.minutes >= minutesOf(r.from) && at.minutes < minutesOf(r.to)
