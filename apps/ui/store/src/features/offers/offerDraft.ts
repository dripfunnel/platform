import { minorOf, moneyDigits, moneyText } from '@dripfunnel/shared/format'
import { offerIdLimit, type Offer, type OfferAction, type OfferCondition, type OfferKind, type OfferTargets } from '../../api/offers'
import type { ApiMoney } from '../../api/orders'
import { fill, formatCount, messages } from '../../messages'
import { kindOf } from './offerView'

// The offer editor's form (OfferEditor, OFFERS-DESIGN §1, C–M) and how it becomes the one record the API saves (§3.1).
// Amounts are typed in major units per currency and sent as minor units; dates are typed in the store's time zone.

const words = messages.offers.editor.errors

export type Amounts = Record<string, string>
/** A step typed in the main currency, with what it was saved as in every currency (kept while the main amount stands). */
export interface Tier {
  off: string
  minimum: string
  savedOff?: ApiMoney[]
  savedMinimum?: ApiMoney[]
}
export type Target = 'products' | 'filter' | 'collection'
export type Minimum = 'none' | 'amount' | 'these' | 'items'
export type Who = 'all' | 'groups' | 'first' | 'customers' | 'market'

export interface OfferDraft {
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
  /** A percentage's cap (E5), in the main currency. */
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
export interface StoreFacts {
  timeZone: string
  country: string | null
  main: string
  others: string[]
  /** Units of each currency per euro (storeLocale.rates); a currency without one isn't converted. */
  perEuro: Record<string, number>
}

export const noTargets: OfferTargets = { productIds: [], collectionIds: [], filterValueIds: [] }


const partsIn = (t: number, timeZone: string) => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(t))
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
 * The store's wall-clock time as an instant. A time the clocks skip (spring forward) moves on by the gap; a time they
 * repeat (fall back) is its first occurrence.
 */
export const instantOf = (local: string, timeZone: string): string | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local)
  if (!m) return null
  const wall = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]))
  const offset = (t: number) => {
    const p = partsIn(t, timeZone)
    return Date.UTC(p.y, p.mo - 1, p.d, p.h, p.mi) - t
  }
  const before = wall - offset(wall - 86_400_000)
  const after = wall - offset(wall + 86_400_000)
  const fits = [Math.min(before, after), Math.max(before, after)].find((t) => localOf(new Date(t).toISOString(), timeZone) === local)
  return new Date(fits ?? before).toISOString()
}

/** "Ends at midnight" is the last second of that day (fact 9). */
export const endInstantOf = (local: string, timeZone: string): string | null => {
  const at = instantOf(local, timeZone)
  return at && local.endsWith('T23:59') ? new Date(new Date(at).getTime() + 59_000).toISOString() : at
}


const majorOf = (minor: string, currency: string) => moneyText({ amount: Number(minor), currency })

// Rates are units per euro to six places, as integers; money is converted once, on integer minor units.
const rateScale = 1_000_000n
const scaledRate = (rate: number | undefined): bigint | null => (rate && rate > 0 ? BigInt(Math.round(rate * Number(rateScale))) : null)

/** Main-currency minor units in another currency's minor units at today's reference rate, half up (#337). */
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
  const converted = typeof minor === 'number' ? convertedMinor(minor, facts, currency) : null
  return converted === null ? null : moneyText({ amount: converted, currency })
}

/** One amount per currency the store sells in: typed ones as typed, the rest converted from the main one. */
const amountsOf = (typed: Amounts, facts: StoreFacts): ApiMoney[] => {
  const main = minorOf(typed[facts.main] ?? '', facts.main)
  if (typeof main !== 'number') return []
  return [
    { currency: facts.main, amount: String(main) },
    ...facts.others.flatMap((c) => {
      const own = (typed[c] ?? '').trim()
      const minor = own ? minorOf(own, c) : convertedMinor(main, facts, c)
      return typeof minor === 'number' ? [{ currency: c, amount: String(minor) }] : []
    }),
  ]
}
const typedOf = (list: readonly ApiMoney[]): Amounts => Object.fromEntries(list.map((m) => [m.currency, majorOf(m.amount, m.currency)]))
const mainOf = (list: readonly ApiMoney[], facts: StoreFacts): string => typedOf(list)[facts.main] ?? ''
/** Amounts typed in the main currency only: as saved while the main amount is unchanged, else converted afresh. */
const keptOr = (typed: string, saved: readonly ApiMoney[], facts: StoreFacts): ApiMoney[] => {
  const minor = minorOf(typed, facts.main)
  const savedMain = saved.find((m) => m.currency === facts.main)
  return typeof minor === 'number' && savedMain && Number(savedMain.amount) === minor ? [...saved] : amountsOf({ [facts.main]: typed }, facts)
}


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
  // Most sellers mean a code; buy X get Y and shipping offers mostly apply by themselves (§5 principle 3).
  trigger: type === 'bxgy' || type === 'shipping' ? 'automatic' : 'code',
  code: '',
  singleUse: false,
  batch: { count: '500', prefix: '', length: '8' },
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
  // A new offer combines with nothing; the merchant opts in (#337).
  combines: { product: false, order: false, shipping: false },
  kept: [],
  description: null,
})

export const recipes = ['welcome', 'freeShipping', 'seasonal', 'buy2get1', 'flash', 'vip', 'winBack'] as const
export type Recipe = (typeof recipes)[number]
export const recipeType: Record<Recipe, OfferKind> = { welcome: 'order', freeShipping: 'shipping', seasonal: 'order', buy2get1: 'bxgy', flash: 'products', vip: 'order', winBack: 'order' }

const codeAlphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
/** A readable code: no 0/O or 1/I to confuse (H1). */
export const generateCode = (length = 8): string => Array.from(crypto.getRandomValues(new Uint8Array(length)), (b) => codeAlphabet[b % codeAlphabet.length] ?? 'A').join('')

/**
 * A seasonal recipe's code from the occasion's name: its letters and digits once accents are taken off ("Diwali" is
 * DIWALI20), or, for a name with none in A–Z 0–9 (春节, Рождество), a generated SALE code, so the code is always valid.
 */
export const seasonCode = (name: string): string => {
  const latin = name.normalize('NFKD').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 12)
  return latin ? `${latin}20` : `SALE${generateCode(4)}20`
}

export interface RecipeContext {
  facts: StoreFacts
  now: Date
  ship: string
  /** The store's next occasion (CATALOG H13), for the seasonal recipe. */
  season: { name: string; on: Date } | null
}

/** A recipe fills the form and leaves the merchant to adjust (V1–V7). */
export const blankDraft = (type: OfferKind, recipe: Recipe | null, ctx: RecipeContext): OfferDraft => {
  const d = blank(recipe ? recipeType[recipe] : type)
  const zone = ctx.facts.timeZone
  const local = (t: number) => localOf(new Date(t).toISOString(), zone)
  const names = messages.offers.editor.recipeNames
  switch (recipe) {
    case 'welcome':
      return { ...d, code: 'WELCOME10', name: names.welcome, who: 'first' }
    case 'freeShipping':
      return { ...d, minimum: 'amount', name: fill(names.freeShipping, { ship: ctx.ship }) }
    case 'seasonal': {
      const season = ctx.season
      if (!season) return { ...d, percent: '20', name: names.sale }
      const day = local(season.on.getTime()).slice(0, 10)
      const start = new Date(season.on.getTime() - 7 * 86_400_000)
      return { ...d, percent: '20', code: seasonCode(season.name), name: fill(names.seasonal, { season: season.name }), startsAt: `${local(start.getTime()).slice(0, 10)}T00:00`, endsAt: `${day}T23:59` }
    }
    case 'buy2get1':
      return { ...d, name: names.buy2get1 }
    case 'flash':
      return { ...d, target: 'filter', percent: '20', code: 'FLASH20', name: names.flash, startsAt: local(ctx.now.getTime()), endsAt: local(ctx.now.getTime() + 24 * 3_600_000) }
    case 'vip':
      return { ...d, percent: '15', code: 'VIP15', name: names.vip, who: 'groups' }
    case 'winBack':
      return { ...d, percent: '15', code: `COMEBACK-${generateCode(5)}`, name: names.winBack, who: 'customers', totalUses: '1' }
    default:
      return { ...d, name: fill(messages.offers.editor.defaultNames[d.type], { ship: ctx.ship }) }
  }
}

const targetOf = (t: OfferTargets | null): Pick<OfferDraft, 'target' | 'productIds' | 'filterValueIds' | 'collectionIds'> => {
  const x = t ?? noTargets
  return { target: x.collectionIds.length ? 'collection' : x.filterValueIds.length ? 'filter' : 'products', productIds: x.productIds, filterValueIds: x.filterValueIds, collectionIds: x.collectionIds }
}

const keptTargets = (t: OfferTargets | null): Omit<OfferTargets, 'productIds'> => ({ collectionIds: t?.collectionIds ?? [], filterValueIds: t?.filterValueIds ?? [] })
const hasKept = (k: Omit<OfferTargets, 'productIds'>) => k.collectionIds.length + k.filterValueIds.length > 0

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
      Object.assign(d, { kind: a.kind === 'fixed' ? 'fixed' : 'percent', tiers: a.tiers.map((t) => ({ off: a.kind === 'fixed' ? mainOf(t.amounts, facts) : String(t.percent ?? ''), minimum: mainOf(t.minimum, facts), savedOff: t.amounts, savedMinimum: t.minimum })) })
      break
    case 'buy_x_get_y':
      Object.assign(d, { buyQuantity: String(a.buy?.quantity ?? 1), buyIds: a.buy?.targets?.productIds ?? [], buyKept: keptTargets(a.buy?.targets ?? null), getQuantity: String(a.get?.quantity ?? 1), getSame: !a.get?.targets, getIds: a.get?.targets?.productIds ?? [], getKept: keptTargets(a.get?.targets ?? null), getPercent: String(a.percent ?? 100), oncePerOrder: a.oncePerOrder })
      break
  }
  // The form has one minimum, one audience and one repeat: the first condition of each fills it, any further one is kept
  // and saved back as it came, so no restriction an offer holds is lost on edit.
  const minimums = ['minimum_order_amount', 'minimum_quantity']
  const audiences = ['customer_group', 'first_order', 'specific_customers', 'shipping_country']
  for (const c of offer.conditions) {
    const minimumTaken = d.minimum !== 'none' && (minimums.includes(c.operation) || theseOf(d, c))
    const audienceTaken = d.who !== 'all' && audiences.includes(c.operation)
    if (minimumTaken || audienceTaken || (c.operation === 'recurrence' && d.repeat)) d.kept.push(c)
    else if (c.operation === 'minimum_order_amount') Object.assign(d, { minimum: 'amount', minAmounts: typedOf(c.amounts) })
    else if (c.operation === 'minimum_quantity') Object.assign(d, { minimum: 'items', minQuantity: String(c.minimum ?? '') })
    else if (theseOf(d, c)) Object.assign(d, { minimum: 'these', minQuantity: String(c.minimum ?? '') })
    else if (c.operation === 'customer_group') Object.assign(d, { who: 'groups', groupIds: c.groupIds })
    else if (c.operation === 'first_order') d.who = 'first'
    else if (c.operation === 'specific_customers') Object.assign(d, { who: 'customers', customerIds: c.customerIds })
    else if (c.operation === 'shipping_country') Object.assign(d, { who: 'market', countries: c.countries })
    else if (c.operation === 'recurrence') d.repeat = { days: c.days, from: c.from ?? '17:00', to: c.to ?? '21:00' }
    else d.kept.push(c)
  }
  return d
}


/** A condition or an action in the API's full shape, every argument it doesn't name empty: the one builder of each. */
export const blankCondition = (c: Partial<OfferCondition> & Pick<OfferCondition, 'operation'>): OfferCondition => ({ amounts: [], minimum: null, productIds: [], collectionIds: [], filterValueIds: [], groupIds: [], customerIds: [], countries: [], days: [], from: null, to: null, conditions: [], ...c })
export const blankAction = (a: Partial<OfferAction> & Pick<OfferAction, 'operation'>): OfferAction => ({ percent: null, amounts: [], cap: [], targets: null, exclude: null, buy: null, get: null, oncePerOrder: false, kind: null, tiers: [], ...a })
const whole = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : null)

const targetsOf = (d: OfferDraft): OfferTargets =>
  d.target === 'collection' ? { ...noTargets, collectionIds: d.collectionIds } : d.target === 'filter' ? { ...noTargets, filterValueIds: d.filterValueIds } : { ...noTargets, productIds: d.productIds }

const actionOf = (d: OfferDraft, facts: StoreFacts): OfferAction => {
  const exclude = { giftCards: d.excludeGiftCards, onSale: d.excludeOnSale }
  const cap = d.capOn && d.kind === 'percent' ? keptOr(d.cap, d.capSaved, facts) : []
  switch (d.type) {
    case 'products':
      return d.kind === 'percent' ? blankAction({ operation: 'products_percentage_discount', percent: whole(d.percent), targets: targetsOf(d), exclude, cap }) : blankAction({ operation: 'line_fixed_discount', amounts: amountsOf(d.amounts, facts), targets: targetsOf(d), exclude })
    case 'order':
      if (d.tiers.length)
        return blankAction({
          operation: 'tiered_discount',
          kind: d.kind,
          tiers: d.tiers.map((t) => ({ minimum: keptOr(t.minimum, t.savedMinimum ?? [], facts), percent: d.kind === 'percent' ? whole(t.off) : null, amounts: d.kind === 'fixed' ? keptOr(t.off, t.savedOff ?? [], facts) : [] })),
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
    const t = targetsOf(d)
    out.push(
      d.target === 'collection'
        ? blankCondition({ operation: 'contains_collection', minimum: n, collectionIds: t.collectionIds })
        : d.target === 'filter'
          ? blankCondition({ operation: 'at_least_n_with_filter_values', minimum: n, filterValueIds: t.filterValueIds })
          : blankCondition({ operation: 'contains_products', minimum: n, productIds: t.productIds }),
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
const targetsInput = (t: OfferTargets | null) => t && { productIds: some(t.productIds), collectionIds: some(t.collectionIds), filterValueIds: some(t.filterValueIds) }

/** Only the arguments each operation takes (OFFERS §3.1): the engine refuses any other. */
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
      return { operation: a.operation, kind: a.kind, tiers: a.tiers.map((t) => (a.kind === 'fixed' ? { minimum: t.minimum, amounts: t.amounts } : { minimum: t.minimum, percent: t.percent })) }
    case 'buy_x_get_y':
      return { operation: a.operation, buy: { quantity: a.buy?.quantity, targets: targetsInput(a.buy?.targets ?? null) }, get: { quantity: a.get?.quantity, targets: targetsInput(a.get?.targets ?? null) ?? undefined }, percent: a.percent, oncePerOrder: a.oncePerOrder }
    case 'free_shipping':
      return { operation: a.operation }
    default:
      return { operation: a.operation, amounts: a.amounts }
  }
}

/** The `OfferInput` Save sends, on or off as the merchant chose (Start now / Schedule / Keep off, #337). */
export const inputOf = (d: OfferDraft, facts: StoreFacts, enabled: boolean) => {
  const o = offerOf(d, facts)
  return { ...o, description: d.description, enabled, conditions: o.conditions.map(conditionInput), action: actionInput(o.action) }
}


export type Field = 'value' | 'targets' | 'buy' | 'get' | 'code' | 'batch' | 'name' | 'minimum' | 'who' | 'ends' | 'repeat' | 'total' | 'perCustomer' | 'tiers' | 'cap'

/** The API's own limits (src/engine/modules/promotions), so the form says them before the API refuses. */
export const offerLimits = { ids: offerIdLimit, prefix: 12, name: 120, quantity: 99, minimum: 999, perCustomer: 1000, total: 100_000_000, batch: 5000, tiers: [2, 5] as const } as const

const amountOk = (text: string, currency: string) => {
  const minor = minorOf(text, currency)
  return typeof minor === 'number' && minor > 0
}
/** Every other currency's box is empty (converted at save) or a positive amount, never dropped or zero. */
const othersOk = (typed: Amounts, facts: StoreFacts) => facts.others.every((c) => !(typed[c] ?? '').trim() || amountOk(typed[c] ?? '', c))
const between = (text: string, low: number, high: number) => {
  const n = whole(text)
  return n !== null && n >= low && n <= high
}

export const errorsOf = (d: OfferDraft, facts: StoreFacts): Partial<Record<Field, string>> => {
  const e: Partial<Record<Field, string>> = {}
  const main = facts.main
  if ((d.type === 'products' || d.type === 'order') && !d.tiers.length) {
    if (d.kind === 'percent' && !between(d.percent, 1, 100)) e.value = words.percent
    if (d.kind === 'fixed' && !amountOk(d.amounts[main] ?? '', main)) e.value = words.amount
    else if (d.kind === 'fixed' && !othersOk(d.amounts, facts)) e.value = words.otherAmount
  }
  if (d.type === 'shipping' && d.shipMode === 'off' && !amountOk(d.amounts[main] ?? '', main)) e.value = words.amount
  else if (d.type === 'shipping' && d.shipMode === 'off' && !othersOk(d.amounts, facts)) e.value = words.otherAmount
  if (d.type === 'products') {
    if (d.target === 'products' && !d.productIds.length) e.targets = words.products
    else if (d.productIds.length > offerLimits.ids) e.targets = fill(words.tooMany, { max: String(offerLimits.ids) })
    if (d.target === 'filter' && !d.filterValueIds.length) e.targets = words.filterValue
    if (d.target === 'collection' && !d.collectionIds.length) e.targets = words.collection
  }
  if (d.capOn && d.kind === 'percent' && !d.tiers.length && !amountOk(d.cap, main)) e.cap = words.amount
  if (d.type === 'order' && d.tiers.length) {
    const [low, high] = offerLimits.tiers
    if (d.tiers.length < low || d.tiers.length > high) e.tiers = fill(words.tierCount, { low: String(low), high: String(high) })
    else if (d.tiers.some((t) => !amountOk(t.minimum, main) || (d.kind === 'percent' ? !between(t.off, 1, 100) : !amountOk(t.off, main)))) e.tiers = words.tiers
  }
  if (d.type === 'bxgy') {
    if (!d.buyIds.length && !hasKept(d.buyKept)) e.buy = words.buy
    else if (d.buyIds.length > offerLimits.ids) e.buy = fill(words.tooMany, { max: String(offerLimits.ids) })
    if (!d.getSame && !d.getIds.length && !hasKept(d.getKept)) e.get = words.get
    else if (!d.getSame && d.getIds.length > offerLimits.ids) e.get = fill(words.tooMany, { max: String(offerLimits.ids) })
    if (!between(d.buyQuantity, 1, offerLimits.quantity) || !between(d.getQuantity, 1, offerLimits.quantity)) e.value = fill(words.quantity, { max: String(offerLimits.quantity) })
    else if (!between(d.getPercent, 1, 100)) e.value = words.percent
  }
  if (d.trigger === 'code' && !d.singleUse) {
    const code = d.code.trim().toUpperCase()
    if (!code) e.code = words.codeMissing
    else if (!/^[A-Z0-9][A-Z0-9_-]{2,31}$/.test(code)) e.code = fill(words.codeShape, { min: '3', max: '32' })
  }
  if (d.trigger === 'code' && d.singleUse) {
    if (!between(d.batch.count, 1, offerLimits.batch)) e.batch = fill(words.batchCount, { max: formatCount(offerLimits.batch) })
    else if (!/^([A-Z0-9][A-Z0-9_-]{0,11})?$/.test(d.batch.prefix.trim().toUpperCase())) e.batch = fill(words.batchPrefix, { max: String(offerLimits.prefix) })
  }
  if (!d.name.trim()) e.name = words.name
  else if (d.name.trim().length > offerLimits.name) e.name = fill(words.nameLong, { max: String(offerLimits.name) })
  if (d.minimum === 'amount' && !amountOk(d.minAmounts[main] ?? '', main)) e.minimum = words.minimumAmount
  else if (d.minimum === 'amount' && !othersOk(d.minAmounts, facts)) e.minimum = words.otherAmount
  if ((d.minimum === 'items' || d.minimum === 'these') && !between(d.minQuantity, 1, offerLimits.minimum)) e.minimum = fill(words.minimumItems, { max: String(offerLimits.minimum) })
  if (d.who === 'groups' && !d.groupIds.length) e.who = words.groups
  if (d.who === 'customers' && !d.customerIds.length) e.who = words.customers
  if ((d.who === 'customers' && d.customerIds.length > offerLimits.ids) || (d.who === 'groups' && d.groupIds.length > offerLimits.ids)) e.who = fill(words.tooMany, { max: String(offerLimits.ids) })
  if (d.who === 'market' && !d.countries.length) e.who = words.market
  const starts = d.startsAt ? instantOf(d.startsAt, facts.timeZone) : null
  const ends = d.endsAt ? endInstantOf(d.endsAt, facts.timeZone) : null
  if ((d.startsAt && !starts) || (d.endsAt && !ends)) e.ends = words.date
  else if (starts && ends && ends <= starts) e.ends = words.endsBefore
  if (d.repeat && !d.repeat.days.length) e.repeat = words.repeatDays
  else if (d.repeat && d.repeat.from >= d.repeat.to) e.repeat = words.repeatTimes
  if (d.totalUses.trim() && !between(d.totalUses, 1, offerLimits.total)) e.total = words.total
  // Empty is unlimited; anything else must be a whole number the API takes, never read as unlimited.
  if (d.perCustomer.trim() && !between(d.perCustomer, 1, offerLimits.perCustomer)) e.perCustomer = fill(words.perCustomer, { max: formatCount(offerLimits.perCustomer) })
  return e
}
