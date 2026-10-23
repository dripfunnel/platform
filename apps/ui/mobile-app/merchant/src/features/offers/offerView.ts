import type { ApiMoney, Offer, OfferAction, OfferCondition, OfferKind, OfferTargets } from '../../api/offers'
import { formatList, formatMoney, formatNumber, regionName } from '@dripfunnel/mobile-shared/format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import { saysShipping } from '../common/region'
import type { Tone } from '../products/productView'

// How Offers words an offer (OFFERS-DESIGN §2, §3 fact 9, B2): its type, status and time line, and the one-sentence summary. The API
// decides every rule and figure; this only puts them into the merchant's words.

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

/** The region's words (OFFERS-DESIGN T5, G4): "shipping" in the US and Canada, "delivery" elsewhere; "voucher" outside India and the US. */
export type RegionWords = { ship: string; code: string }
export const regionWords = (country: string | null): RegionWords => ({
  ship: saysShipping(country) ? t('offers.region.shipping') : t('offers.region.delivery'),
  code: country === 'US' || country === 'IN' || country === null ? t('offers.region.coupon') : t('offers.region.voucher'),
})

export type StatusKey = 'live' | 'ending' | 'scheduled' | 'off' | 'ended' | 'used_up'

/** "Ending soon" is the portal's reading of a live offer's end (fact 9): within this many hours. */
const endingSoonHours = 48
const hour = 3_600_000

export const statusKeyOf = (offer: Pick<Offer, 'status' | 'endsAt'>, now: Date): StatusKey =>
  offer.status === 'live' && offer.endsAt && new Date(offer.endsAt).getTime() - now.getTime() <= endingSoonHours * hour ? 'ending' : offer.status

export const statusTone: Record<StatusKey, Tone> = { live: 'success', ending: 'warning', scheduled: 'neutral', off: 'neutral', ended: 'neutral', used_up: 'warning' }

export const dateTimeText = (iso: string, timeZone: string): string =>
  new Intl.DateTimeFormat(locale, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(new Date(iso))
export const dayText = (iso: string, timeZone: string): string => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(new Date(iso))

/** The store's zone as a name ("India Standard Time"), said once on a screen rather than on every row. */
export const zoneName = (timeZone: string): string => new Intl.DateTimeFormat(locale, { timeZone, timeZoneName: 'longGeneric' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value ?? timeZone

/** A day of the week by its number, 0 being Sunday as a repeat's days are. */
export const weekdayName = (day: number): string => new Intl.DateTimeFormat(locale, { weekday: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2023, 0, 1 + day)))
const recurrenceOf = (offer: Pick<Offer, 'conditions'>) => offer.conditions.find((c) => c.operation === 'recurrence') ?? null
export const repeatText = (r: Pick<OfferCondition, 'days' | 'from' | 'to'>): string =>
  t('offers.repeat', { days: r.days.length === 7 ? t('offers.everyDay') : formatList([...r.days].sort().map(weekdayName), locale), from: r.from ?? '', to: r.to ?? '' })

/** The line under a status: when it started, ends or starts, or how much of it is used (fact 9, principle 7). */
export const timeLine = (offer: Pick<Offer, 'status' | 'startsAt' | 'endsAt' | 'usesCount' | 'totalUsesLimit' | 'conditions'>, now: Date, timeZone: string): string => {
  const key = statusKeyOf(offer, now)
  const ends = offer.endsAt
  switch (key) {
    case 'live': {
      const repeat = recurrenceOf(offer)
      if (repeat) return repeatText(repeat)
      if (ends) return t('offers.time.ends', { date: dateTimeText(ends, timeZone) })
      return offer.startsAt ? t('offers.time.startedNoEnd', { day: dayText(offer.startsAt, timeZone) }) : t('offers.time.noEnd')
    }
    case 'ending':
      return t('offers.time.endsIn', { hours: formatNumber(Math.max(1, Math.round((new Date(ends ?? now).getTime() - now.getTime()) / hour)), locale), date: dateTimeText(ends ?? now.toISOString(), timeZone) })
    case 'scheduled': {
      if (!offer.startsAt) return t('offers.time.scheduled')
      const days = Math.max(1, Math.ceil((new Date(offer.startsAt).getTime() - now.getTime()) / (24 * hour)))
      return tCount('offers.time.startsIn', days, { date: dateTimeText(offer.startsAt, timeZone) })
    }
    case 'off':
      return ends && new Date(ends) <= now ? t('offers.time.offPassed', { day: dayText(ends, timeZone) }) : t('offers.time.off')
    case 'ended':
      return ends ? t('offers.time.ended', { day: dayText(ends, timeZone) }) : t('offers.status.ended')
    case 'used_up':
      return t('offers.time.usedUp', { used: formatNumber(offer.usesCount, locale), total: formatNumber(offer.totalUsesLimit ?? offer.usesCount, locale) })
  }
}

/** Names the API's ids stand for, read once per screen; anything missing is counted instead. */
export type OfferNames = { collections: ReadonlyMap<string, string>; filterValues: ReadonlyMap<string, string>; groups: ReadonlyMap<string, string> }
export const noNames: OfferNames = { collections: new Map(), filterValues: new Map(), groups: new Map() }

export const moneyText = (money: ApiMoney): string => formatMoney(money, locale)
const amountText = (amounts: readonly ApiMoney[]): string => formatList(amounts.map(moneyText), locale)
/** Any of several: "VIP or Wholesale" (OFFERS-DESIGN I2, "several groups mean any of"). */
export const orList = (items: readonly string[]): string => new Intl.ListFormat(locale, { type: 'disjunction' }).format(items)
export const countryName = (code: string): string => regionName(code, locale)

const targetsText = (targets: OfferTargets | null, names: OfferNames): string => {
  if (!targets) return t('offers.what.chosenProducts')
  const named = (ids: readonly string[], map: ReadonlyMap<string, string>) => ids.map((id) => map.get(id)).filter((name): name is string => Boolean(name))
  const parts = [
    ...(targets.productIds.length ? [tCount('offers.what.products', targets.productIds.length)] : []),
    ...(named(targets.collectionIds, names.collections).length === targets.collectionIds.length ? named(targets.collectionIds, names.collections) : targets.collectionIds.length ? [tCount('offers.what.collections', targets.collectionIds.length)] : []),
    ...(named(targets.filterValueIds, names.filterValues).length === targets.filterValueIds.length ? named(targets.filterValueIds, names.filterValues) : targets.filterValueIds.length ? [tCount('offers.what.filterValues', targets.filterValueIds.length)] : []),
  ]
  return parts.length ? formatList(parts, locale) : t('offers.what.chosenProducts')
}

const minimumOf = (offer: Pick<Offer, 'conditions'>) => offer.conditions.find((c) => c.operation === 'minimum_order_amount') ?? null

const getKey = (percent: number | null): 'bxgyFree' | 'bxgyHalf' | 'bxgyPercent' => (percent === null || percent === 100 ? 'bxgyFree' : percent === 50 ? 'bxgyHalf' : 'bxgyPercent')

/** What the shopper gets, short, for a row (B2): "20% off · Linen", "Free delivery · over ₹999". */
export const whatText = (offer: Pick<Offer, 'action' | 'conditions'>, region: RegionWords, names: OfferNames): string => {
  const a = offer.action
  const min = minimumOf(offer)
  const over = min ? [t('offers.what.over', { amount: amountText(min.amounts) })] : []
  const groups = offer.conditions.find((c) => c.operation === 'customer_group')
  const who = groups ? [orList(groups.groupIds.map((id) => names.groups.get(id) ?? t('offers.what.aGroup')))] : []
  const join = (parts: string[]) => [...parts, ...who].join(t('offers.joiner'))
  switch (a.operation) {
    case 'products_percentage_discount':
      return join([t('offers.what.percentOff', { percent: String(a.percent ?? 0) }), targetsText(a.targets, names)])
    case 'line_fixed_discount':
      return join([t('offers.what.eachOff', { amount: amountText(a.amounts) }), targetsText(a.targets, names)])
    case 'order_percentage_discount':
      return join([t('offers.what.orderPercent', { percent: String(a.percent ?? 0) }), ...over])
    case 'order_fixed_discount':
      return join([t('offers.what.orderAmount', { amount: amountText(a.amounts) }), ...over])
    case 'tiered_discount':
      return join([t('offers.what.tiered')])
    case 'buy_x_get_y':
      return join([t(`offers.what.${getKey(a.percent)}`, { buy: String(a.buy?.quantity ?? 1), get: String(a.get?.quantity ?? 1), percent: String(a.percent ?? 100) })])
    case 'shipping_fixed_discount':
      return join([t('offers.what.shipAmount', { amount: amountText(a.amounts), ship: region.ship }), ...over])
    default:
      return join([t('offers.what.shipFree', { ship: region.ship }), ...over])
  }
}

type Sentenced = Pick<Offer, 'action' | 'conditions' | 'trigger' | 'code' | 'startsAt' | 'endsAt' | 'perCustomerLimit' | 'totalUsesLimit' | 'combines'>

/** The offer in one sentence (OFFERS-DESIGN §1, C1): what they get, how, the minimum, who, when, limits and what it combines with. */
export const sentence = (offer: Sentenced, region: RegionWords, names: OfferNames, now: Date, timeZone: string): string => {
  const a = offer.action
  const parts: string[] = []
  const exclusions = [a.exclude?.giftCards ? t('offers.sentence.giftCards') : '', a.exclude?.onSale ? t('offers.sentence.onSale') : ''].filter(Boolean)
  switch (a.operation) {
    case 'products_percentage_discount':
      parts.push(t('offers.sentence.percentOff', { percent: String(a.percent ?? 0), targets: targetsText(a.targets, names) }))
      break
    case 'line_fixed_discount':
      parts.push(t('offers.sentence.eachOff', { amount: amountText(a.amounts), targets: targetsText(a.targets, names) }))
      break
    case 'order_percentage_discount':
      parts.push(t('offers.sentence.orderPercent', { percent: String(a.percent ?? 0) }))
      break
    case 'order_fixed_discount':
      parts.push(t('offers.sentence.orderAmount', { amount: amountText(a.amounts) }))
      break
    case 'tiered_discount':
      parts.push(formatList(a.tiers.map((tier) => t('offers.sentence.tier', { off: a.kind === 'fixed' ? amountText(tier.amounts) : `${tier.percent ?? 0}%`, minimum: amountText(tier.minimum) })), locale))
      break
    case 'buy_x_get_y':
      parts.push(
        t(`offers.sentence.${getKey(a.percent)}`, {
          buy: String(a.buy?.quantity ?? 1),
          buyTargets: targetsText(a.buy?.targets ?? null, names),
          get: String(a.get?.quantity ?? 1),
          getTargets: a.get?.targets ? targetsText(a.get.targets, names) : t('offers.sentence.more'),
          percent: String(a.percent ?? 100),
        }) + (a.oncePerOrder ? t('offers.sentence.oncePerOrder') : ''),
      )
      break
    case 'shipping_fixed_discount':
      parts.push(t('offers.sentence.shipAmount', { amount: amountText(a.amounts), ship: region.ship }))
      break
    default:
      parts.push(t('offers.sentence.shipFree', { ship: region.ship }))
  }
  if (exclusions.length) parts.push(t('offers.sentence.except', { list: formatList(exclusions, locale) }))
  if (a.cap.length) parts.push(t('offers.sentence.cap', { amount: amountText(a.cap) }))
  parts.push(offer.trigger === 'automatic' ? t('offers.sentence.automatic') : offer.code ? t('offers.sentence.code', { code: offer.code }) : t('offers.sentence.singleUse'))
  for (const c of offer.conditions) {
    if (c.operation === 'minimum_order_amount') parts.push(t('offers.sentence.minimumAmount', { amount: amountText(c.amounts) }))
    if (c.operation === 'minimum_quantity') parts.push(t('offers.sentence.minimumItems', { count: String(c.minimum ?? 1) }))
    if (c.operation === 'contains_products' || c.operation === 'contains_collection' || c.operation === 'at_least_n_with_filter_values') parts.push(t('offers.sentence.minimumThese', { count: String(c.minimum ?? 1) }))
    if (c.operation === 'customer_group') parts.push(t('offers.sentence.groups', { names: orList(c.groupIds.map((id) => names.groups.get(id) ?? t('offers.what.aGroup'))) }))
    if (c.operation === 'first_order') parts.push(t('offers.sentence.firstOrder'))
    if (c.operation === 'specific_customers') parts.push(tCount('offers.sentence.customers', c.customerIds.length))
    if (c.operation === 'shipping_country') parts.push(t('offers.sentence.countries', { countries: formatList(c.countries.map(countryName), locale) }))
    if (c.operation === 'recurrence') parts.push(repeatText(c))
  }
  if (offer.startsAt && new Date(offer.startsAt) > now) parts.push(t('offers.sentence.starts', { day: dayText(offer.startsAt, timeZone) }))
  parts.push(offer.endsAt ? t('offers.sentence.ends', { day: dayText(offer.endsAt, timeZone) }) : t('offers.sentence.noEnd'))
  if (offer.perCustomerLimit) parts.push(offer.perCustomerLimit === 1 ? t('offers.sentence.oncePerCustomer') : t('offers.sentence.timesPerCustomer', { count: String(offer.perCustomerLimit) }))
  if (offer.totalUsesLimit) parts.push(t('offers.sentence.firstUses', { count: formatNumber(offer.totalUsesLimit, locale) }))
  const kinds = (['product', 'order', 'shipping'] as const).filter((k) => !offer.combines[k]).map((k) => (k === 'shipping' ? region.ship : t(`offers.sentence.kinds.${k}`)))
  if (kinds.length === 3) parts.push(t('offers.sentence.combinesNothing'))
  else if (kinds.length) parts.push(t('offers.sentence.combinesNot', { kinds: formatList(kinds, locale) }))
  return parts.join(t('offers.joiner'))
}
