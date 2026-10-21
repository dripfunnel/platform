import { allocate, applyBps } from '#core/money'
import { classOf, inWindow, type Action, type Amounts, type Combines, type Condition, type LeafCondition, type LocalTime, type OfferClass, type Targets } from './definition'

// Pricing a cart's offers, pure: the stage order, ranking and combining are OFFERS-DESIGN §3.1 (facts 4–11, PLATFORM-PROMPT §5.4).

export interface PricingLine {
  id: string
  productId: string
  quantity: number
  /** The line at today's price, before any offer. */
  amount: bigint
  collectionIds: readonly string[]
  filterValueIds: readonly string[]
  giftCard: boolean
  /** Has a compare-at price: already reduced. */
  onSale: boolean
}

export interface PricingShopper {
  customerId: string | null
  groupIds: readonly string[]
  /** True only when the shopper is known and has no placed order yet. */
  firstOrder: boolean
  /** Where the order goes; null until there is an address. */
  country: string | null
}

export interface PricingOffer {
  id: string
  name: string
  /** The code the shopper entered for it; null for an automatic offer. */
  codeId: string | null
  createdAt: Date
  conditions: readonly Condition[]
  action: Action
  combines: Combines
}

export interface PricingInput {
  currency: string
  lines: readonly PricingLine[]
  /** The chosen delivery's price; null until one is chosen. */
  shipping: bigint | null
  shopper: PricingShopper
  local: LocalTime
  offers: readonly PricingOffer[]
}

export interface AppliedOffer {
  offerId: string
  codeId: string | null
  name: string
  class: OfferClass
  amount: bigint
  /** What it took off each line, by line id; empty for a shipping offer. */
  lines: ReadonlyMap<string, bigint>
}

/** Why an offer the shopper might expect didn't apply: its conditions, nothing in the cart it discounts, or another offer it doesn't combine with. */
export type NotApplied = 'CONDITIONS' | 'NOTHING_TO_DISCOUNT' | 'DOESNT_COMBINE'

export interface PricingResult {
  applied: AppliedOffer[]
  notApplied: { offerId: string; reason: NotApplied }[]
  /** Each line's discount, by line id. */
  lineDiscounts: ReadonlyMap<string, bigint>
  shippingDiscount: bigint
  discount: bigint
}

const stages: readonly OfferClass[] = ['product', 'order', 'shipping']

const matches = (t: Targets, l: PricingLine): boolean =>
  t.productIds.includes(l.productId) || l.collectionIds.some((c) => t.collectionIds.includes(c)) || l.filterValueIds.some((f) => t.filterValueIds.includes(f))

const unitsWhere = (lines: readonly PricingLine[], test: (l: PricingLine) => boolean) => lines.filter(test).reduce((n, l) => n + l.quantity, 0)

interface Facts {
  currency: string
  lines: readonly PricingLine[]
  subtotal: bigint
  shopper: PricingShopper
  local: LocalTime
}

const holds = (c: LeafCondition, f: Facts): boolean => {
  switch (c.operation) {
    case 'minimum_order_amount': {
      const minimum = c.amounts[f.currency]
      return minimum !== undefined && f.subtotal >= minimum
    }
    case 'minimum_quantity':
      return unitsWhere(f.lines, () => true) >= c.minimum
    case 'contains_products':
      return unitsWhere(f.lines, (l) => c.productIds.includes(l.productId)) >= c.minimum
    case 'contains_collection':
      return unitsWhere(f.lines, (l) => l.collectionIds.some((x) => c.collectionIds.includes(x))) >= c.minimum
    case 'at_least_n_with_filter_values':
      return unitsWhere(f.lines, (l) => l.filterValueIds.some((x) => c.filterValueIds.includes(x))) >= c.minimum
    case 'customer_group':
      return f.shopper.groupIds.some((g) => c.groupIds.includes(g))
    case 'specific_customers':
      return f.shopper.customerId !== null && c.customerIds.includes(f.shopper.customerId)
    case 'first_order':
      return f.shopper.firstOrder
    case 'shipping_country':
      return f.shopper.country !== null && c.countries.includes(f.shopper.country)
    case 'recurrence':
      return inWindow(c, f.local)
  }
}

const conditionsHold = (conditions: readonly Condition[], f: Facts): boolean =>
  conditions.every((c) => (c.operation === 'any_of' ? c.conditions.some((x) => holds(x, f)) : holds(c, f)))

interface State {
  /** What each line comes to now, after the offers taken so far. */
  left: bigint[]
  shippingLeft: bigint | null
}

interface Effect {
  lines: bigint[]
  shipping: bigint
}

const none = (n: number): Effect => ({ lines: Array.from({ length: n }, () => 0n), shipping: 0n })
const pct = (amount: bigint, percent: number) => applyBps({ amount, currency: 'XXX' }, percent * 100).amount
const capped = (effect: bigint[], cap: Amounts | null, currency: string): bigint[] | null => {
  if (!cap) return effect
  const most = cap[currency]
  if (most === undefined) return null
  const total = effect.reduce((s, x) => s + x, 0n)
  return total <= most ? effect : allocate(most, effect)
}

/** What one action takes off now, line by line; none when an amount it needs isn't set in the cart's currency (fact 10). */
const effectOf = (action: Action, lines: readonly PricingLine[], state: State, currency: string, subtotal: bigint): Effect => {
  const empty = none(lines.length)
  const orderWide = (total: bigint): Effect => ({ lines: allocate(total > subtotal ? subtotal : total, state.left), shipping: 0n })
  const eligible = (t: Targets, exclude: { giftCards: boolean; onSale: boolean }) => (l: PricingLine) => matches(t, l) && !(exclude.giftCards && l.giftCard) && !(exclude.onSale && l.onSale)
  switch (action.operation) {
    case 'order_percentage_discount': {
      const total = pct(subtotal, action.percent)
      const effect = capped(allocate(total, state.left), action.cap, currency)
      return effect ? { lines: effect, shipping: 0n } : empty
    }
    case 'order_fixed_discount': {
      const amount = action.amounts[currency]
      return amount === undefined ? empty : orderWide(amount)
    }
    case 'tiered_discount': {
      const reached = action.tiers.filter((t) => {
        const minimum = t.minimum[currency]
        return minimum !== undefined && subtotal >= minimum
      })
      const top = reached.sort((a, b) => ((a.minimum[currency] ?? 0n) < (b.minimum[currency] ?? 0n) ? 1 : -1))[0]
      if (!top) return empty
      if (action.kind === 'percent') return orderWide(pct(subtotal, top.percent ?? 0))
      const amount = top.amounts?.[currency]
      return amount === undefined ? empty : orderWide(amount)
    }
    case 'products_percentage_discount': {
      const test = eligible(action.targets, action.exclude)
      const effect = capped(
        lines.map((l, i) => (test(l) ? pct(state.left[i] ?? 0n, action.percent) : 0n)),
        action.cap,
        currency,
      )
      return effect ? { lines: effect, shipping: 0n } : empty
    }
    case 'line_fixed_discount': {
      const amount = action.amounts[currency]
      if (amount === undefined) return empty
      const test = eligible(action.targets, action.exclude)
      return { lines: lines.map((l, i) => (test(l) ? min(amount * BigInt(l.quantity), state.left[i] ?? 0n) : 0n)), shipping: 0n }
    }
    case 'buy_x_get_y': {
      const getTargets = action.get.targets ?? action.buy.targets
      const same = action.get.targets === null
      const bought = unitsWhere(lines, (l) => matches(action.buy.targets, l))
      const perSet = action.buy.quantity + (same ? action.get.quantity : 0)
      const sets = Math.min(Math.floor(bought / perSet), action.oncePerOrder ? 1 : Infinity)
      let free = sets * action.get.quantity
      // The cheapest qualifying units, one by one, at what each comes to now.
      const units = lines.flatMap((l, i) => (matches(getTargets, l) ? Array.from({ length: l.quantity }, () => ({ i, unit: (state.left[i] ?? 0n) / BigInt(l.quantity) })) : []))
      units.sort((a, b) => (a.unit === b.unit ? a.i - b.i : a.unit < b.unit ? -1 : 1))
      const effect = [...empty.lines]
      for (const u of units) {
        if (free === 0) break
        effect[u.i] = min((effect[u.i] ?? 0n) + pct(u.unit, action.percent), state.left[u.i] ?? 0n)
        free -= 1
      }
      return { lines: effect, shipping: 0n }
    }
    case 'free_shipping':
      return { lines: empty.lines, shipping: state.shippingLeft ?? 0n }
    case 'shipping_fixed_discount': {
      const amount = action.amounts[currency]
      return { lines: empty.lines, shipping: amount === undefined || state.shippingLeft === null ? 0n : min(amount, state.shippingLeft) }
    }
  }
}

const min = (a: bigint, b: bigint) => (a < b ? a : b)
const sum = (e: Effect) => e.lines.reduce((s, x) => s + x, 0n) + e.shipping

const combine = (a: PricingOffer, b: PricingOffer) => a.combines[classOf(b.action)] && b.combines[classOf(a.action)]

export const priceOffers = (input: PricingInput): PricingResult => {
  const { lines, currency } = input
  const state: State = { left: lines.map((l) => l.amount), shippingLeft: input.shipping }
  const applied: AppliedOffer[] = []
  const taken: PricingOffer[] = []
  const notApplied: PricingResult['notApplied'] = []
  for (const stage of stages) {
    const subtotal = state.left.reduce((s, x) => s + x, 0n)
    const facts: Facts = { currency, lines, subtotal, shopper: input.shopper, local: input.local }
    const inStage = input.offers.filter((o) => classOf(o.action) === stage)
    const holding = inStage.filter((o) => {
      const ok = conditionsHold(o.conditions, facts)
      if (!ok) notApplied.push({ offerId: o.id, reason: 'CONDITIONS' })
      return ok
    })
    // Biggest first as each would price alone now, then oldest, then by id: deterministic whatever order they came in.
    const ranked = holding
      .map((o) => ({ o, alone: sum(effectOf(o.action, lines, state, currency, subtotal)) }))
      .sort((a, b) => (a.alone !== b.alone ? (a.alone > b.alone ? -1 : 1) : a.o.createdAt.getTime() - b.o.createdAt.getTime() || a.o.id.localeCompare(b.o.id)))
    for (const { o } of ranked) {
      if (taken.some((a) => !combine(a, o))) {
        notApplied.push({ offerId: o.id, reason: 'DOESNT_COMBINE' })
        continue
      }
      const effect = effectOf(o.action, lines, state, currency, state.left.reduce((s, x) => s + x, 0n))
      const amount = sum(effect)
      if (amount === 0n) {
        notApplied.push({ offerId: o.id, reason: 'NOTHING_TO_DISCOUNT' })
        continue
      }
      effect.lines.forEach((x, i) => {
        state.left[i] = (state.left[i] ?? 0n) - x
      })
      if (state.shippingLeft !== null) state.shippingLeft -= effect.shipping
      taken.push(o)
      applied.push({ offerId: o.id, codeId: o.codeId, name: o.name, class: stage, amount, lines: new Map(lines.flatMap((l, i) => ((effect.lines[i] ?? 0n) > 0n ? [[l.id, effect.lines[i] ?? 0n] as const] : []))) })
    }
  }
  const lineDiscounts = new Map(lines.map((l, i) => [l.id, l.amount - (state.left[i] ?? 0n)]))
  const shippingDiscount = input.shipping === null || state.shippingLeft === null ? 0n : input.shipping - state.shippingLeft
  return {
    applied,
    notApplied,
    lineDiscounts,
    shippingDiscount,
    discount: [...lineDiscounts.values()].reduce((s, x) => s + x, 0n) + shippingDiscount,
  }
}
