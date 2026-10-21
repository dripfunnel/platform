import type { StatusIconName, StatusTone } from '@dripfunnel/shared/ui'
import type { ApiMoney } from '../../api/orders'
import type { Offer, OfferAction, OfferCondition, OfferKind, OfferTargets } from '../../api/offers'
import { fill, formatCount, formatList, locale, messages, plural } from '../../messages'
import { saysShipping } from '../common/region'
import { moneyText } from '../orders/orderView'

// How Offers words an offer (OFFERS-DESIGN §2, §3 fact 9, B2): its type, status and time line, and the one-sentence
// summary. The API decides every rule and figure; this only puts them into the merchant's words.

const words = messages.offers

export const kindOf = (action: Pick<OfferAction, 'operation'>): OfferKind => {
  switch (action.operation) {
    case 'products_percentage_discount':
    case 'line_fixed_discount':
      return 'products'
    case 'buy_x_get_y':
      return 'bxgy'
    case 'free_shipping':
    case 'shipping_fixed_discount':
      return 'shipping'
    default:
      return 'order'
  }
}

/** The region's words (T5, G4): "shipping" in the US, "delivery" elsewhere; "voucher" outside India and the US. */
export interface RegionWords {
  ship: string
  code: string
}
export const regionWords = (country: string | null): RegionWords => ({
  ship: saysShipping(country) ? words.region.shipping : words.region.delivery,
  code: country === 'US' || country === 'IN' || country === null ? words.region.coupon : words.region.voucher,
})

export type StatusKey = 'live' | 'ending' | 'scheduled' | 'off' | 'ended' | 'used_up'

/** "Ending soon" is the portal's reading of a live offer's end (fact 9): within this many hours. */
const endingSoonHours = 48
const hour = 3_600_000

export const statusKeyOf = (offer: Pick<Offer, 'status' | 'endsAt'>, now: Date): StatusKey =>
  offer.status === 'live' && offer.endsAt && new Date(offer.endsAt).getTime() - now.getTime() <= endingSoonHours * hour ? 'ending' : offer.status

// A status is a word, an icon and a colour, never colour alone (fact 9, design.md §10).
export const statusLook: Record<StatusKey, { tone: StatusTone; icon: StatusIconName }> = {
  live: { tone: 'success', icon: 'ok' },
  ending: { tone: 'warning', icon: 'hour' },
  scheduled: { tone: 'info', icon: 'clock' },
  off: { tone: 'neutral', icon: 'pause' },
  ended: { tone: 'neutral', icon: 'ban' },
  used_up: { tone: 'warning', icon: 'alert' },
}

export const dateTimeText = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso))
export const dayText = (iso: string, timeZone: string): string => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(new Date(iso))

/** A day of the week by its number, 0 being Sunday as a repeat's days are. */
export const weekdayName = (day: number) => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + day)))
const recurrenceOf = (offer: Pick<Offer, 'conditions'>) => offer.conditions.find((c) => c.operation === 'recurrence') ?? null
export const repeatText = (r: Pick<OfferCondition, 'days' | 'from' | 'to'>): string =>
  fill(words.repeat, { days: r.days.length === 7 ? words.everyDay : formatList([...r.days].sort().map(weekdayName)), from: r.from ?? '', to: r.to ?? '' })

/** The line under a status: when it started, ends or starts, or how much of it is used (fact 9, principle 7). */
export const timeLine = (offer: Pick<Offer, 'status' | 'startsAt' | 'endsAt' | 'usesCount' | 'totalUsesLimit' | 'conditions'>, now: Date, timeZone: string): string => {
  const key = statusKeyOf(offer, now)
  const ends = offer.endsAt
  switch (key) {
    case 'live': {
      const r = recurrenceOf(offer)
      if (r) return repeatText(r)
      if (ends) return fill(words.time.ends, { date: dateTimeText(ends, timeZone) })
      return offer.startsAt ? fill(words.time.startedNoEnd, { day: dayText(offer.startsAt, timeZone) }) : words.time.noEnd
    }
    case 'ending':
      return fill(words.time.endsIn, { hours: formatCount(Math.max(1, Math.round((new Date(ends ?? now).getTime() - now.getTime()) / hour))), date: dateTimeText(ends ?? now.toISOString(), timeZone) })
    case 'scheduled': {
      if (!offer.startsAt) return words.time.scheduled
      const days = Math.max(1, Math.ceil((new Date(offer.startsAt).getTime() - now.getTime()) / (24 * hour)))
      return fill(plural(words.time.startsIn, days), { count: formatCount(days), date: dateTimeText(offer.startsAt, timeZone) })
    }
    case 'off':
      return ends && new Date(ends) <= now ? fill(words.time.offPassed, { day: dayText(ends, timeZone) }) : words.time.off
    case 'ended':
      return ends ? fill(words.time.ended, { day: dayText(ends, timeZone) }) : words.status.ended
    case 'used_up':
      return fill(words.time.usedUp, { used: formatCount(offer.usesCount), total: formatCount(offer.totalUsesLimit ?? offer.usesCount) })
  }
}

/** Names the API's ids stand for, read once per screen; anything missing is counted instead. */
export interface OfferNames {
  collections: ReadonlyMap<string, string>
  filterValues: ReadonlyMap<string, string>
  groups: ReadonlyMap<string, string>
}
export const noNames: OfferNames = { collections: new Map(), filterValues: new Map(), groups: new Map() }

const amountText = (amounts: readonly ApiMoney[]): string => formatList(amounts.map(moneyText))
/** Any of several: "VIP or Wholesale" (I2, "several groups mean any of"). */
export const orList = (items: readonly string[]): string => new Intl.ListFormat(locale, { type: 'disjunction' }).format(items)
export const countryName = (code: string) => new Intl.DisplayNames(locale, { type: 'region' }).of(code) ?? code
const counted = (forms: { one?: string; other: string }, n: number) => fill(plural(forms, n), { count: formatCount(n) })

const targetsText = (t: OfferTargets | null, names: OfferNames): string => {
  if (!t) return words.what.chosenProducts
  const named = (ids: readonly string[], map: ReadonlyMap<string, string>) => ids.map((id) => map.get(id)).filter((n): n is string => Boolean(n))
  const parts = [
    ...(t.productIds.length ? [counted(words.what.products, t.productIds.length)] : []),
    ...(named(t.collectionIds, names.collections).length === t.collectionIds.length ? named(t.collectionIds, names.collections) : t.collectionIds.length ? [counted(words.what.collections, t.collectionIds.length)] : []),
    ...(named(t.filterValueIds, names.filterValues).length === t.filterValueIds.length ? named(t.filterValueIds, names.filterValues) : t.filterValueIds.length ? [counted(words.what.filterValues, t.filterValueIds.length)] : []),
  ]
  return parts.length ? formatList(parts) : words.what.chosenProducts
}

const minimumOf = (offer: Pick<Offer, 'conditions'>) => offer.conditions.find((c) => c.operation === 'minimum_order_amount') ?? null

/** What the shopper gets, short, for a row (B2): "20% off · Linen", "Free delivery · over ₹999". */
export const whatText = (offer: Pick<Offer, 'action' | 'conditions'>, region: RegionWords, names: OfferNames): string => {
  const a = offer.action
  const min = minimumOf(offer)
  const over = min ? [fill(words.what.over, { amount: amountText(min.amounts) })] : []
  const groups = offer.conditions.find((c) => c.operation === 'customer_group')
  const who = groups ? [orList(groups.groupIds.map((id) => names.groups.get(id) ?? words.what.aGroup))] : []
  const join = (parts: string[]) => [...parts, ...who].join(words.joiner)
  switch (a.operation) {
    case 'products_percentage_discount':
      return join([fill(words.what.percentOff, { percent: String(a.percent ?? 0) }), targetsText(a.targets, names)])
    case 'line_fixed_discount':
      return join([fill(words.what.eachOff, { amount: amountText(a.amounts) }), targetsText(a.targets, names)])
    case 'order_percentage_discount':
      return join([fill(words.what.orderPercent, { percent: String(a.percent ?? 0) }), ...over])
    case 'order_fixed_discount':
      return join([fill(words.what.orderAmount, { amount: amountText(a.amounts) }), ...over])
    case 'tiered_discount':
      return join([words.what.tiered])
    case 'buy_x_get_y':
      return join([fill(getWords(a.percent), { buy: String(a.buy?.quantity ?? 1), get: String(a.get?.quantity ?? 1), percent: String(a.percent ?? 100) })])
    case 'shipping_fixed_discount':
      return join([fill(words.what.shipAmount, { amount: amountText(a.amounts), ship: region.ship }), ...over])
    default:
      return join([fill(words.what.shipFree, { ship: region.ship }), ...over])
  }
}

const getWords = (percent: number | null) => (percent === null || percent === 100 ? words.what.bxgyFree : percent === 50 ? words.what.bxgyHalf : words.what.bxgyPercent)

/** The offer in one sentence (§1, C1): what they get, how, the minimum, who, when, limits and what it combines with. */
export const sentence = (offer: Pick<Offer, 'action' | 'conditions' | 'trigger' | 'code' | 'startsAt' | 'endsAt' | 'perCustomerLimit' | 'totalUsesLimit' | 'combines'>, region: RegionWords, names: OfferNames, now: Date, timeZone: string): string => {
  const s = words.sentence
  const a = offer.action
  const parts: string[] = []
  const exclusions = [a.exclude?.giftCards ? s.giftCards : '', a.exclude?.onSale ? s.onSale : ''].filter(Boolean)
  switch (a.operation) {
    case 'products_percentage_discount':
      parts.push(fill(s.percentOff, { percent: String(a.percent ?? 0), targets: targetsText(a.targets, names) }))
      break
    case 'line_fixed_discount':
      parts.push(fill(s.eachOff, { amount: amountText(a.amounts), targets: targetsText(a.targets, names) }))
      break
    case 'order_percentage_discount':
      parts.push(fill(s.orderPercent, { percent: String(a.percent ?? 0) }))
      break
    case 'order_fixed_discount':
      parts.push(fill(s.orderAmount, { amount: amountText(a.amounts) }))
      break
    case 'tiered_discount':
      parts.push(formatList(a.tiers.map((t) => fill(s.tier, { off: a.kind === 'fixed' ? amountText(t.amounts) : `${t.percent ?? 0}%`, minimum: amountText(t.minimum) }))))
      break
    case 'buy_x_get_y':
      parts.push(
        fill(a.percent === null || a.percent === 100 ? s.bxgyFree : a.percent === 50 ? s.bxgyHalf : s.bxgyPercent, {
          buy: String(a.buy?.quantity ?? 1),
          buyTargets: targetsText(a.buy?.targets ?? null, names),
          get: String(a.get?.quantity ?? 1),
          getTargets: a.get?.targets ? targetsText(a.get.targets, names) : s.more,
          percent: String(a.percent ?? 100),
        }) + (a.oncePerOrder ? s.oncePerOrder : ''),
      )
      break
    case 'shipping_fixed_discount':
      parts.push(fill(s.shipAmount, { amount: amountText(a.amounts), ship: region.ship }))
      break
    default:
      parts.push(fill(s.shipFree, { ship: region.ship }))
  }
  if (exclusions.length) parts.push(fill(s.except, { list: formatList(exclusions) }))
  if (a.cap.length) parts.push(fill(s.cap, { amount: amountText(a.cap) }))
  parts.push(offer.trigger === 'automatic' ? s.automatic : offer.code ? fill(s.code, { code: offer.code }) : s.singleUse)
  for (const c of offer.conditions) {
    if (c.operation === 'minimum_order_amount') parts.push(fill(s.minimumAmount, { amount: amountText(c.amounts) }))
    if (c.operation === 'minimum_quantity') parts.push(fill(s.minimumItems, { count: String(c.minimum ?? 1) }))
    if (c.operation === 'contains_products' || c.operation === 'contains_collection' || c.operation === 'at_least_n_with_filter_values') parts.push(fill(s.minimumThese, { count: String(c.minimum ?? 1) }))
    if (c.operation === 'customer_group') parts.push(fill(s.groups, { names: orList(c.groupIds.map((id) => names.groups.get(id) ?? words.what.aGroup)) }))
    if (c.operation === 'first_order') parts.push(s.firstOrder)
    if (c.operation === 'specific_customers') parts.push(counted(s.customers, c.customerIds.length))
    if (c.operation === 'shipping_country') parts.push(fill(s.countries, { countries: formatList(c.countries.map(countryName)) }))
    if (c.operation === 'recurrence') parts.push(repeatText(c))
  }
  if (offer.startsAt && new Date(offer.startsAt) > now) parts.push(fill(s.starts, { day: dayText(offer.startsAt, timeZone) }))
  parts.push(offer.endsAt ? fill(s.ends, { day: dayText(offer.endsAt, timeZone) }) : s.noEnd)
  if (offer.perCustomerLimit) parts.push(offer.perCustomerLimit === 1 ? s.oncePerCustomer : fill(s.timesPerCustomer, { count: String(offer.perCustomerLimit) }))
  if (offer.totalUsesLimit) parts.push(fill(s.firstUses, { count: formatCount(offer.totalUsesLimit) }))
  const kinds = (['product', 'order', 'shipping'] as const).filter((k) => !offer.combines[k]).map((k) => (k === 'shipping' ? region.ship : s.kinds[k]))
  if (kinds.length === 3) parts.push(s.combinesNothing)
  else if (kinds.length) parts.push(fill(s.combinesNot, { kinds: formatList(kinds) }))
  return parts.join(words.joiner)
}
