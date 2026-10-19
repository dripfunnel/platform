import { formatNumber, minorOf as minorDigits, moneyDigits, moneyText } from '../../format'
import { codeBatchLimits, codeLengths, codePrefixPattern, offerIdLimit, type ApiMoney, type Offer, type OfferAction, type OfferCondition, type OfferKind, type OfferTargets } from '../../api/offers'
import { locale, t } from '../../messages'
import { kindOf } from './offerView'

// The offer editor's form and how it becomes the one record the API saves (OFFERS-DESIGN §3.1). Amounts are typed in major units per
// currency and sent as minor units; dates are typed on the store's wall clock and sent as instants.

export type Amounts = Record<string, string>
/** A step typed in the main currency, with what it was saved as in every currency (kept while the main amount stands). */
export type Tier = { off: string; minimum: string; savedOff?: ApiMoney[]; savedMinimum?: ApiMoney[] }
export type Target = 'products' | 'filter' | 'collection'
export type Minimum = 'none' | 'amount' | 'these' | 'items'
export type Who = 'all' | 'groups' | 'first' | 'customers' | 'market'

export type OfferDraft = {
  type: OfferKind
  kind: 'percent' | 'fixed'
  percent: string
  amounts: Amounts
  target: Target
  productIds: string[]
  filterValueIds: string[]
  collectionIds: string[]
  excludeGiftCards: boolean
  excludeOnSale: boolean
  /** Steps of a tiered order offer, in the main currency; none is a plain one. */
  tiers: Tier[]
  /** A percentage's cap, in the main currency. */
  capOn: boolean
  cap: string
  /** The cap as saved, in every currency; sent back unchanged while the main amount is. */
  capSaved: ApiMoney[]
  buyQuantity: string
  getQuantity: string
  buyIds: string[]
  /** Collections and filter values a buy X get Y names besides products, which the form doesn't draw: kept as they came. */
  buyKept: Omit<OfferTargets, 'productIds'>
  getKept: Omit<OfferTargets, 'productIds'>
  getSame: boolean
  getIds: string[]
  getPercent: string
  oncePerOrder: boolean
  shipMode: 'free' | 'off'
  trigger: Offer['trigger']
  code: string
  singleUse: boolean
  batch: { count: string; prefix: string; length: string }
  name: string
  note: string
  minimum: Minimum
  minAmounts: Amounts
  minQuantity: string
  who: Who
  groupIds: string[]
  customerIds: string[]
  countries: string[]
  /** Store-local "2026-10-12T09:00"; empty is "as soon as it's turned on" or "no end date". */
  startsAt: string
  endsAt: string
  repeat: { days: number[]; from: string; to: string } | null
  totalUses: string
  perCustomer: string
  combines: Offer['combines']
  /** Conditions this form doesn't draw (the API's "any of"), saved back as they came. */
  kept: OfferCondition[]
  /** The offer's description, which this form doesn't draw, saved back as it came. */
  description: string | null
}

/** What the form needs to know of the store: its time zone, its currencies (the main one first) and their rates. */
export type StoreFacts = {
  timeZone: string
  country: string | null
  main: string
  others: string[]
  /** Units of each currency per euro (storeLocale.rates); a currency without one isn't converted. */
  perEuro: Record<string, number>
}

export const noTargets: OfferTargets = { productIds: [], collectionIds: [], filterValueIds: [] }

const partsIn = (instant: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(instant))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return { y: get('year'), mo: get('month'), d: get('day'), h: get('hour'), mi: get('minute') }
}
const pad = (n: number) => String(n).padStart(2, '0')

/** An instant as the store's wall clock reads it: "2026-10-12T09:00". */
export const localOf = (iso: string, timeZone: string): string => {
  const p = partsIn(new Date(iso).getTime(), timeZone)
  return `${p.y}-${pad(p.mo)}-${pad(p.d)}T${pad(p.h)}:${pad(p.mi)}`
}

/**
 * The store's wall-clock time as an instant. A time the clocks skip (spring forward) moves on by the gap; a time they repeat
 * (fall back) is its first occurrence.
 */
export const instantOf = (local: string, timeZone: string): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  // A date the calendar hasn't got (31 February, month 13, hour 25) is no date, never the day it rolls over to.
  if (new Date(wall).toISOString().slice(0, 16) !== local) return null
  const offset = (instant: number) => {
    const p = partsIn(instant, timeZone)
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - instant
  }
  const before = wall - offset(wall - 86_400_000)
  const after = wall - offset(wall + 86_400_000)
  const fits = [Math.min(before, after), Math.max(before, after)].find((instant) => localOf(new Date(instant).toISOString(), timeZone) === local)
  return new Date(fits ?? before).toISOString()
}

/** "Ends at midnight" is the last second of that day (OFFERS-DESIGN fact 9). */
export const endInstantOf = (local: string, timeZone: string): string | null => {
  const at = instantOf(local, timeZone)
  return at && local.endsWith('T23:59') ? new Date(new Date(at).getTime() + 59_000).toISOString() : at
}

/** Typed major units as a whole number of minor units; anything that isn't an amount, or is more than a number holds exactly, is null. */
const minorOf = (text: string, currency: string): number | null => {
  const minor = minorDigits(text, currency)
  return typeof minor === 'string' && minor !== 'invalid' && Number.isSafeInteger(Number(minor)) ? Number(minor) : null
}
const majorOf = (minor: string, currency: string) => moneyText({ amount: minor, currency })

// Rates are units per euro to six places, as integers; money is converted once, on integer minor units.
const rateScale = 1_000_000n
const scaledRate = (rate: number | undefined): bigint | null => (rate && rate > 0 ? BigInt(Math.round(rate * Number(rateScale))) : null)

/** Main-currency minor units in another currency's minor units at today's reference rate, half up. */
export const convertedMinor = (minor: number, facts: StoreFacts, currency: string): number | null => {
  const from = scaledRate(facts.perEuro[facts.main])
  const to = scaledRate(facts.perEuro[currency])
  if (from === null || to === null || !Number.isInteger(minor) || minor < 0) return null
  const num = BigInt(minor) * 10n ** BigInt(moneyDigits(currency)) * to
  const den = from * 10n ** BigInt(moneyDigits(facts.main))
  return Number((2n * num + den) / (2n * den))
}

/** The main currency's typed amount as another's box would hold it, converted. */
export const convertedText = (text: string, facts: StoreFacts, currency: string): string | null => {
  const minor = minorOf(text, facts.main)
  const converted = minor === null ? null : convertedMinor(minor, facts, currency)
  return converted === null ? null : majorOf(String(converted), currency)
}

/** One amount per currency the store sells in: typed ones as typed, the rest converted from the main one. */
const amountsOf = (typed: Amounts, facts: StoreFacts): ApiMoney[] => {
  const main = minorOf(typed[facts.main] ?? '', facts.main)
  if (main === null) return []
  return [
    { currency: facts.main, amount: String(main) },
    ...facts.others.flatMap((c) => {
      const own = (typed[c] ?? '').trim()
      const minor = own ? minorOf(own, c) : convertedMinor(main, facts, c)
      return minor === null ? [] : [{ currency: c, amount: String(minor) }]
    }),
  ]
}
const typedOf = (list: readonly ApiMoney[]): Amounts => Object.fromEntries(list.map((m) => [m.currency, majorOf(m.amount, m.currency)]))
const mainOf = (list: readonly ApiMoney[], facts: StoreFacts): string => typedOf(list)[facts.main] ?? ''
/** An amount typed in the main currency only, per currency: while it's unchanged each currency keeps its saved amount and one added
 *  since is converted (OFFERS-DESIGN §3.1); a changed main amount converts them all afresh. */
const keptTyped = (typed: string, saved: readonly ApiMoney[], facts: StoreFacts): Amounts => {
  const minor = minorOf(typed, facts.main)
  const savedMain = saved.find((m) => m.currency === facts.main)
  return minor !== null && savedMain && Number(savedMain.amount) === minor ? typedOf(saved) : { [facts.main]: typed }
}
const keptOr = (typed: string, saved: readonly ApiMoney[], facts: StoreFacts): ApiMoney[] => amountsOf(keptTyped(typed, saved, facts), facts)

const blank = (type: OfferKind): OfferDraft => ({
  type,
  kind: 'percent',
  percent: type === 'order' ? '10' : '20',
  amounts: {},
  target: 'products',
  productIds: [],
  filterValueIds: [],
  collectionIds: [],
  excludeGiftCards: false,
  excludeOnSale: false,
  tiers: [],
  capOn: false,
  cap: '',
  capSaved: [],
  buyQuantity: '2',
  getQuantity: '1',
  buyIds: [],
  buyKept: { collectionIds: [], filterValueIds: [] },
  getKept: { collectionIds: [], filterValueIds: [] },
  getSame: true,
  getIds: [],
  getPercent: '100',
  oncePerOrder: false,
  shipMode: 'free',
  // Most sellers mean a code; buy X get Y and shipping offers mostly apply by themselves (OFFERS-DESIGN §5 principle 3).
  trigger: type === 'bxgy' || type === 'shipping' ? 'automatic' : 'code',
  code: '',
  singleUse: false,
  batch: { count: '500', prefix: '', length: String(codeLengths[1]) },
  name: '',
  note: '',
  minimum: 'none',
  minAmounts: {},
  minQuantity: '',
  who: 'all',
  groupIds: [],
  customerIds: [],
  countries: [],
  startsAt: '',
  endsAt: '',
  repeat: null,
  totalUses: '',
  perCustomer: type === 'bxgy' || type === 'shipping' ? '' : '1',
  // A new offer combines with nothing; the merchant opts in.
  combines: { product: false, order: false, shipping: false },
  kept: [],
  description: null,
})

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** A readable code, with no 0/O or 1/I to confuse. A shared code is public by design; single-use codes are the API's to make. */
export const generateCode = (length = 8): string => Array.from({ length }, () => codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)] ?? 'A').join('')

/** A new offer of a kind, named as the kind says. */
export const blankDraft = (type: OfferKind, ship: string): OfferDraft => ({ ...blank(type), name: t(`offers.editor.defaultNames.${type}`, { ship }) })

const targetOf = (targets: OfferTargets | null): Pick<OfferDraft, 'target' | 'productIds' | 'filterValueIds' | 'collectionIds'> => {
  const x = targets ?? noTargets
  return { target: x.collectionIds.length ? 'collection' : x.filterValueIds.length ? 'filter' : 'products', productIds: x.productIds, filterValueIds: x.filterValueIds, collectionIds: x.collectionIds }
}

const keptTargets = (targets: OfferTargets | null): Omit<OfferTargets, 'productIds'> => ({ collectionIds: targets?.collectionIds ?? [], filterValueIds: targets?.filterValueIds ?? [] })
const hasKept = (kept: Omit<OfferTargets, 'productIds'>) => kept.collectionIds.length + kept.filterValueIds.length > 0

/** A "buys at least N of these" the form can draw: on a products offer, naming exactly what the offer discounts. */
const theseOf = (d: OfferDraft, c: OfferCondition): boolean => {
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x))
  if (d.type !== 'products') return false
  if (c.operation === 'contains_products') return d.target === 'products' && same(c.productIds, d.productIds)
  if (c.operation === 'contains_collection') return d.target === 'collection' && same(c.collectionIds, d.collectionIds)
  if (c.operation === 'at_least_n_with_filter_values') return d.target === 'filter' && same(c.filterValueIds, d.filterValueIds)
  return false
}

/** The form for an offer the API gave, every field as it stands. */
export const draftOf = (offer: Offer, facts: StoreFacts): OfferDraft => {
  const a: OfferAction = offer.action
  const d: OfferDraft = {
    ...blank(kindOf(a)),
    trigger: offer.trigger,
    code: offer.code ?? '',
    singleUse: offer.trigger === 'code' && !offer.code,
    name: offer.name,
    note: offer.internalName ?? '',
    startsAt: offer.startsAt ? localOf(offer.startsAt, facts.timeZone) : '',
    endsAt: offer.endsAt ? localOf(offer.endsAt, facts.timeZone) : '',
    totalUses: offer.totalUsesLimit ? String(offer.totalUsesLimit) : '',
    perCustomer: offer.perCustomerLimit ? String(offer.perCustomerLimit) : '',
    combines: offer.combines,
    description: offer.description,
  }
  const fixed = { kind: 'fixed' as const, amounts: typedOf(a.amounts) }
  const percent = { kind: 'percent' as const, percent: String(a.percent ?? ''), capOn: a.cap.length > 0, cap: mainOf(a.cap, facts), capSaved: a.cap }
  const exclude = { excludeGiftCards: a.exclude?.giftCards ?? false, excludeOnSale: a.exclude?.onSale ?? false }
  switch (a.operation) {
    case 'products_percentage_discount':
      Object.assign(d, percent, targetOf(a.targets), exclude)
      break
    case 'line_fixed_discount':
      Object.assign(d, fixed, targetOf(a.targets), exclude)
      break
    case 'order_percentage_discount':
      Object.assign(d, percent)
      break
    case 'order_fixed_discount':
    case 'shipping_fixed_discount':
      Object.assign(d, fixed, a.operation === 'shipping_fixed_discount' ? { shipMode: 'off' } : {})
      break
    case 'tiered_discount':
      Object.assign(d, {
        kind: a.kind === 'fixed' ? 'fixed' : 'percent',
        tiers: a.tiers.map((tier) => ({ off: a.kind === 'fixed' ? mainOf(tier.amounts, facts) : String(tier.percent ?? ''), minimum: mainOf(tier.minimum, facts), savedOff: tier.amounts, savedMinimum: tier.minimum })),
      })
      break
    case 'buy_x_get_y':
      Object.assign(d, {
        buyQuantity: String(a.buy?.quantity ?? 1),
        buyIds: a.buy?.targets?.productIds ?? [],
        buyKept: keptTargets(a.buy?.targets ?? null),
        getQuantity: String(a.get?.quantity ?? 1),
        getSame: !a.get?.targets,
        getIds: a.get?.targets?.productIds ?? [],
        getKept: keptTargets(a.get?.targets ?? null),
        getPercent: String(a.percent ?? 100),
        oncePerOrder: a.oncePerOrder,
      })
      break
  }
  // The form has one minimum, one audience and one repeat: the first condition of each fills it, any further one is kept and saved back
  // as it came, so no restriction an offer holds is lost on edit.
  const minimums = ['minimum_order_amount', 'minimum_quantity']
  const audiences = ['customer_group', 'first_order', 'specific_customers', 'shipping_country']
  for (const c of offer.conditions) {
    const minimumTaken = d.minimum !== 'none' && (minimums.includes(c.operation) || theseOf(d, c))
    const audienceTaken = d.who !== 'all' && audiences.includes(c.operation)
    // A repeat without both times isn't one the form can draw; it is kept rather than given times the merchant never set.
    const repeatKept = c.operation === 'recurrence' && (d.repeat !== null || c.from === null || c.to === null)
    if (minimumTaken || audienceTaken || repeatKept) d.kept.push(c)
    else if (c.operation === 'minimum_order_amount') Object.assign(d, { minimum: 'amount', minAmounts: typedOf(c.amounts) })
    else if (c.operation === 'minimum_quantity') Object.assign(d, { minimum: 'items', minQuantity: String(c.minimum ?? '') })
    else if (theseOf(d, c)) Object.assign(d, { minimum: 'these', minQuantity: String(c.minimum ?? '') })
    else if (c.operation === 'customer_group') Object.assign(d, { who: 'groups', groupIds: c.groupIds })
    else if (c.operation === 'first_order') d.who = 'first'
    else if (c.operation === 'specific_customers') Object.assign(d, { who: 'customers', customerIds: c.customerIds })
    else if (c.operation === 'shipping_country') Object.assign(d, { who: 'market', countries: c.countries })
    else if (c.operation === 'recurrence' && c.from !== null && c.to !== null) d.repeat = { days: c.days, from: c.from, to: c.to }
    else d.kept.push(c)
  }
  return d
}

/** A condition or an action in the API's full shape, every argument it doesn't name empty: the one builder of each. */
export const blankCondition = (c: Partial<OfferCondition> & Pick<OfferCondition, 'operation'>): OfferCondition => ({
  amounts: [],
  minimum: null,
  productIds: [],
  collectionIds: [],
  filterValueIds: [],
  groupIds: [],
  customerIds: [],
  countries: [],
  days: [],
  from: null,
  to: null,
  conditions: [],
  ...c,
})
export const blankAction = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null)

const targetsOf = (d: OfferDraft): OfferTargets =>
  d.target === 'collection' ? { ...noTargets, collectionIds: d.collectionIds } : d.target === 'filter' ? { ...noTargets, filterValueIds: d.filterValueIds } : { ...noTargets, productIds: d.productIds }

const actionOf = (d: OfferDraft, facts: StoreFacts): OfferAction => {
  const exclude = { giftCards: d.excludeGiftCards, onSale: d.excludeOnSale }
  const cap = d.capOn && d.kind === 'percent' ? keptOr(d.cap, d.capSaved, facts) : []
  switch (d.type) {
    case 'products':
      return d.kind === 'percent'
        ? blankAction({ operation: 'products_percentage_discount', percent: whole(d.percent), targets: targetsOf(d), exclude, cap })
        : blankAction({ operation: 'line_fixed_discount', amounts: amountsOf(d.amounts, facts), targets: targetsOf(d), exclude })
    case 'order':
      if (d.tiers.length)
        return blankAction({
          operation: 'tiered_discount',
          kind: d.kind,
          tiers: d.tiers.map((tier) => ({ minimum: keptOr(tier.minimum, tier.savedMinimum ?? [], facts), percent: d.kind === 'percent' ? whole(tier.off) : null, amounts: d.kind === 'fixed' ? keptOr(tier.off, tier.savedOff ?? [], facts) : [] })),
        })
      return d.kind === 'percent' ? blankAction({ operation: 'order_percentage_discount', percent: whole(d.percent), cap }) : blankAction({ operation: 'order_fixed_discount', amounts: amountsOf(d.amounts, facts) })
    case 'bxgy':
      return blankAction({
        operation: 'buy_x_get_y',
        buy: { quantity: whole(d.buyQuantity) ?? 1, targets: { ...d.buyKept, productIds: d.buyIds } },
        get: { quantity: whole(d.getQuantity) ?? 1, targets: d.getSame ? null : { ...d.getKept, productIds: d.getIds } },
        percent: whole(d.getPercent),
        oncePerOrder: d.oncePerOrder,
      })
    case 'shipping':
      return d.shipMode === 'off' ? blankAction({ operation: 'shipping_fixed_discount', amounts: amountsOf(d.amounts, facts) }) : blankAction({ operation: 'free_shipping' })
  }
}

const conditionsOf = (d: OfferDraft, facts: StoreFacts): OfferCondition[] => {
  const out: OfferCondition[] = []
  const n = whole(d.minQuantity)
  if (d.minimum === 'amount') out.push(blankCondition({ operation: 'minimum_order_amount', amounts: amountsOf(d.minAmounts, facts) }))
  if (d.minimum === 'items') out.push(blankCondition({ operation: 'minimum_quantity', minimum: n }))
  if (d.minimum === 'these' && d.type === 'products') {
    const targets = targetsOf(d)
    out.push(
      d.target === 'collection'
        ? blankCondition({ operation: 'contains_collection', minimum: n, collectionIds: targets.collectionIds })
        : d.target === 'filter'
          ? blankCondition({ operation: 'at_least_n_with_filter_values', minimum: n, filterValueIds: targets.filterValueIds })
          : blankCondition({ operation: 'contains_products', minimum: n, productIds: targets.productIds }),
    )
  }
  if (d.who === 'groups') out.push(blankCondition({ operation: 'customer_group', groupIds: d.groupIds }))
  if (d.who === 'first') out.push(blankCondition({ operation: 'first_order' }))
  if (d.who === 'customers') out.push(blankCondition({ operation: 'specific_customers', customerIds: d.customerIds }))
  if (d.who === 'market') out.push(blankCondition({ operation: 'shipping_country', countries: d.countries }))
  if (d.repeat) out.push(blankCondition({ operation: 'recurrence', days: [...d.repeat.days].sort(), from: d.repeat.from, to: d.repeat.to }))
  return [...out, ...d.kept]
}

/** The offer as the form stands, in the API's own shape: what the summary words and what Save sends. */
export const offerOf = (d: OfferDraft, facts: StoreFacts) => ({
  name: d.name.trim(),
  internalName: d.note.trim() || null,
  trigger: d.trigger,
  code: d.trigger === 'code' && !d.singleUse ? d.code.trim().toUpperCase() || null : null,
  startsAt: d.startsAt ? instantOf(d.startsAt, facts.timeZone) : null,
  endsAt: d.endsAt ? endInstantOf(d.endsAt, facts.timeZone) : null,
  totalUsesLimit: whole(d.totalUses),
  perCustomerLimit: whole(d.perCustomer),
  combines: d.combines,
  conditions: conditionsOf(d, facts),
  action: actionOf(d, facts),
})

const some = <T>(list: readonly T[]) => (list.length ? list : undefined)
const targetsInput = (targets: OfferTargets | null) => targets && { productIds: some(targets.productIds), collectionIds: some(targets.collectionIds), filterValueIds: some(targets.filterValueIds) }

/** Only the arguments each operation takes (OFFERS-DESIGN §3.1): the engine refuses any other. */
const conditionInput = (c: Omit<OfferCondition, 'conditions'> & { conditions?: OfferCondition['conditions'] }): Record<string, unknown> => {
  switch (c.operation) {
    case 'minimum_order_amount':
      return { operation: c.operation, amounts: c.amounts }
    case 'minimum_quantity':
      return { operation: c.operation, minimum: c.minimum }
    case 'contains_products':
      return { operation: c.operation, minimum: c.minimum, productIds: c.productIds }
    case 'contains_collection':
      return { operation: c.operation, minimum: c.minimum, collectionIds: c.collectionIds }
    case 'at_least_n_with_filter_values':
      return { operation: c.operation, minimum: c.minimum, filterValueIds: c.filterValueIds }
    case 'customer_group':
      return { operation: c.operation, groupIds: c.groupIds }
    case 'specific_customers':
      return { operation: c.operation, customerIds: c.customerIds }
    case 'shipping_country':
      return { operation: c.operation, countries: c.countries }
    case 'recurrence':
      return { operation: c.operation, days: c.days, from: c.from, to: c.to }
    case 'any_of':
      return { operation: c.operation, conditions: (c.conditions ?? []).map(conditionInput) }
    default:
      return { operation: c.operation }
  }
}

const actionInput = (a: OfferAction): Record<string, unknown> => {
  switch (a.operation) {
    case 'products_percentage_discount':
      return { operation: a.operation, percent: a.percent, targets: targetsInput(a.targets), exclude: a.exclude, cap: some(a.cap) }
    case 'line_fixed_discount':
      return { operation: a.operation, amounts: a.amounts, targets: targetsInput(a.targets), exclude: a.exclude }
    case 'order_percentage_discount':
      return { operation: a.operation, percent: a.percent, cap: some(a.cap) }
    case 'tiered_discount':
      return { operation: a.operation, kind: a.kind, tiers: a.tiers.map((tier) => (a.kind === 'fixed' ? { minimum: tier.minimum, amounts: tier.amounts } : { minimum: tier.minimum, percent: tier.percent })) }
    case 'buy_x_get_y':
      return {
        operation: a.operation,
        buy: { quantity: a.buy?.quantity, targets: targetsInput(a.buy?.targets ?? null) },
        get: { quantity: a.get?.quantity, targets: targetsInput(a.get?.targets ?? null) ?? undefined },
        percent: a.percent,
        oncePerOrder: a.oncePerOrder,
      }
    case 'free_shipping':
      return { operation: a.operation }
    default:
      return { operation: a.operation, amounts: a.amounts }
  }
}

/** The `OfferInput` Save sends, on or off as the merchant chose. */
export const inputOf = (d: OfferDraft, facts: StoreFacts, enabled: boolean) => {
  const o = offerOf(d, facts)
  return { ...o, description: d.description, enabled, conditions: o.conditions.map(conditionInput), action: actionInput(o.action) }
}

export type Field = 'value' | 'targets' | 'buy' | 'get' | 'code' | 'batch' | 'name' | 'note' | 'minimum' | 'who' | 'ends' | 'repeat' | 'total' | 'perCustomer' | 'tiers' | 'cap'

/** The API's own limits (apps/api src/engine/modules/promotions), so the form says them before the API refuses. */
export const offerLimits = { ids: offerIdLimit, code: [3, 32] as const, prefix: codeBatchLimits.prefix, codeLength: [6, 16] as const, name: 120, note: 120, quantity: 99, minimum: 999, perCustomer: 1000, total: 100_000_000, batch: codeBatchLimits.count, tiers: [2, 5] as const } as const
const clock = /^([01]\d|2[0-3]):[0-5]\d$/
const codePattern = new RegExp(`^[A-Z0-9][A-Z0-9_-]{${offerLimits.code[0] - 1},${offerLimits.code[1] - 1}}$`)

const amountOk = (text: string, currency: string) => {
  const minor = minorOf(text, currency)
  return minor !== null && minor > 0
}
/** Every other currency's box is empty (converted at save) or a positive amount, never dropped or zero. */
const othersOk = (typed: Amounts, facts: StoreFacts) => facts.others.every((c) => !(typed[c] ?? '').trim() || amountOk(typed[c] ?? '', c))
/** Currencies an empty box can't be filled in at save: there's no reference rate for them (or the main one) today. */
const unrated = (typed: Amounts, facts: StoreFacts): string[] => facts.others.filter((c) => !(typed[c] ?? '').trim() && convertedMinor(1, facts, c) === null)
const noRate = (currencies: readonly string[]) => t('offers.editor.errors.noRate', { currencies: currencies.join(', ') })
const tiersUnrated = (d: OfferDraft, facts: StoreFacts): string[] => [
  ...new Set(d.tiers.flatMap((tier) => [...unrated(keptTyped(tier.minimum, tier.savedMinimum ?? [], facts), facts), ...(d.kind === 'fixed' ? unrated(keptTyped(tier.off, tier.savedOff ?? [], facts), facts) : [])])),
]
const tooMany = () => t('offers.editor.errors.tooMany', { max: String(offerLimits.ids) })

const between = (text: string, low: number, high: number) => {
  const n = whole(text)
  return n !== null && n >= low && n <= high
}

export const errorsOf = (d: OfferDraft, facts: StoreFacts): Partial<Record<Field, string>> => {
  const e: Partial<Record<Field, string>> = {}
  const main = facts.main
  if ((d.type === 'products' || d.type === 'order') && !d.tiers.length) {
    if (d.kind === 'percent' && !between(d.percent, 1, 100)) e.value = t('offers.editor.errors.percent')
    if (d.kind === 'fixed' && !amountOk(d.amounts[main] ?? '', main)) e.value = t('offers.editor.errors.amount')
    else if (d.kind === 'fixed' && !othersOk(d.amounts, facts)) e.value = t('offers.editor.errors.otherAmount')
    else if (d.kind === 'fixed' && unrated(d.amounts, facts).length) e.value = noRate(unrated(d.amounts, facts))
  }
  if (d.type === 'shipping' && d.shipMode === 'off' && !amountOk(d.amounts[main] ?? '', main)) e.value = t('offers.editor.errors.amount')
  else if (d.type === 'shipping' && d.shipMode === 'off' && !othersOk(d.amounts, facts)) e.value = t('offers.editor.errors.otherAmount')
  else if (d.type === 'shipping' && d.shipMode === 'off' && unrated(d.amounts, facts).length) e.value = noRate(unrated(d.amounts, facts))
  if (d.type === 'products') {
    if (d.target === 'products' && !d.productIds.length) e.targets = t('offers.editor.errors.products')
    if (d.target === 'filter' && !d.filterValueIds.length) e.targets = t('offers.editor.errors.filterValue')
    if (d.target === 'collection' && !d.collectionIds.length) e.targets = t('offers.editor.errors.collection')
    if ({ products: d.productIds, filter: d.filterValueIds, collection: d.collectionIds }[d.target].length > offerLimits.ids) e.targets = tooMany()
  }
  if (d.capOn && d.kind === 'percent' && !d.tiers.length && !amountOk(d.cap, main)) e.cap = t('offers.editor.errors.amount')
  // A cap's and a step's other currencies have no boxes: one not kept as saved is converted, so a missing rate stops it.
  else if (d.capOn && d.kind === 'percent' && !d.tiers.length && unrated(keptTyped(d.cap, d.capSaved, facts), facts).length) e.cap = noRate(unrated(keptTyped(d.cap, d.capSaved, facts), facts))
  if (d.type === 'order' && d.tiers.length) {
    const [low, high] = offerLimits.tiers
    if (d.tiers.length < low || d.tiers.length > high) e.tiers = t('offers.editor.errors.tierCount', { low: String(low), high: String(high) })
    else if (d.tiers.some((tier) => !amountOk(tier.minimum, main) || (d.kind === 'percent' ? !between(tier.off, 1, 100) : !amountOk(tier.off, main)))) e.tiers = t('offers.editor.errors.tiers')
    else if (tiersUnrated(d, facts).length) e.tiers = noRate(tiersUnrated(d, facts))
  }
  if (d.type === 'bxgy') {
    if (!d.buyIds.length && !hasKept(d.buyKept)) e.buy = t('offers.editor.errors.buy')
    else if (d.buyIds.length > offerLimits.ids) e.buy = tooMany()
    if (!d.getSame && !d.getIds.length && !hasKept(d.getKept)) e.get = t('offers.editor.errors.get')
    else if (!d.getSame && d.getIds.length > offerLimits.ids) e.get = tooMany()
    if (!between(d.buyQuantity, 1, offerLimits.quantity) || !between(d.getQuantity, 1, offerLimits.quantity)) e.value = t('offers.editor.errors.quantity', { max: String(offerLimits.quantity) })
    else if (!between(d.getPercent, 1, 100)) e.value = t('offers.editor.errors.percent')
  }
  if (d.trigger === 'code' && !d.singleUse) {
    const code = d.code.trim().toUpperCase()
    if (!code) e.code = t('offers.editor.errors.codeMissing')
    else if (!codePattern.test(code)) e.code = t('offers.editor.errors.codeShape', { min: String(offerLimits.code[0]), max: String(offerLimits.code[1]) })
  }
  if (d.trigger === 'code' && d.singleUse) {
    if (!between(d.batch.count, 1, offerLimits.batch)) e.batch = t('offers.editor.errors.batchCount', { max: formatNumber(offerLimits.batch, locale) })
    else if (!codePrefixPattern.test(d.batch.prefix.trim().toUpperCase())) e.batch = t('offers.editor.errors.batchPrefix', { max: String(offerLimits.prefix) })
    else if (!between(d.batch.length, ...offerLimits.codeLength)) e.batch = t('offers.editor.errors.batchLength', { low: String(offerLimits.codeLength[0]), high: String(offerLimits.codeLength[1]) })
  }
  if (!d.name.trim()) e.name = t('offers.editor.errors.name')
  else if (d.name.trim().length > offerLimits.name) e.name = t('offers.editor.errors.nameLong', { max: String(offerLimits.name) })
  if (d.note.trim().length > offerLimits.note) e.note = t('offers.editor.errors.noteLong', { max: String(offerLimits.note) })
  if (d.minimum === 'amount' && !amountOk(d.minAmounts[main] ?? '', main)) e.minimum = t('offers.editor.errors.minimumAmount')
  else if (d.minimum === 'amount' && !othersOk(d.minAmounts, facts)) e.minimum = t('offers.editor.errors.otherAmount')
  else if (d.minimum === 'amount' && unrated(d.minAmounts, facts).length) e.minimum = noRate(unrated(d.minAmounts, facts))
  if ((d.minimum === 'items' || d.minimum === 'these') && !between(d.minQuantity, 1, offerLimits.minimum)) e.minimum = t('offers.editor.errors.minimumItems', { max: String(offerLimits.minimum) })
  if (d.who === 'groups' && !d.groupIds.length) e.who = t('offers.editor.errors.groups')
  if (d.who === 'customers' && !d.customerIds.length) e.who = t('offers.editor.errors.customers')
  if ((d.who === 'customers' && d.customerIds.length > offerLimits.ids) || (d.who === 'groups' && d.groupIds.length > offerLimits.ids)) e.who = tooMany()
  if (d.who === 'market' && !d.countries.length) e.who = t('offers.editor.errors.market')
  const starts = d.startsAt ? instantOf(d.startsAt, facts.timeZone) : null
  const ends = d.endsAt ? endInstantOf(d.endsAt, facts.timeZone) : null
  if ((d.startsAt && !starts) || (d.endsAt && !ends)) e.ends = t('offers.editor.errors.date')
  else if (starts && ends && ends <= starts) e.ends = t('offers.editor.errors.endsBefore')
  if (d.repeat && !d.repeat.days.length) e.repeat = t('offers.editor.errors.repeatDays')
  else if (d.repeat && !(clock.test(d.repeat.from) && clock.test(d.repeat.to))) e.repeat = t('offers.editor.errors.repeatClock')
  else if (d.repeat && d.repeat.from >= d.repeat.to) e.repeat = t('offers.editor.errors.repeatTimes')
  if (d.totalUses.trim() && !between(d.totalUses, 1, offerLimits.total)) e.total = t('offers.editor.errors.total')
  // Empty is unlimited; anything else must be a whole number the API takes, never read as unlimited.
  if (d.perCustomer.trim() && !between(d.perCustomer, 1, offerLimits.perCustomer)) e.perCustomer = t('offers.editor.errors.perCustomer', { max: formatNumber(offerLimits.perCustomer, locale) })
  return e
}
