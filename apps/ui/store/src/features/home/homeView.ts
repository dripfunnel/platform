import type { ApiMoney } from '../../api/orders'
import type { StoreHome, StoreLocaleFacts } from '../../api/home'
import { fill, formatCount, locale, messages, plural } from '../../messages'
import { moneyText } from '../orders/orderView'

// How PortalHome words the API's `home` (FIRST-RELEASE §5): "Needs you", the checklist and the numbers. Every count and
// sum is the API's, and a figure a seat may not see arrives as null and is left out here.

const words = messages.home

export type TaskKind = 'toShip' | 'collect' | 'approval' | 'lowStock' | 'courier'

export interface Task {
  kind: TaskKind
  count: number
  title: string
  body: string
  /** The order a payment to collect opens. */
  orderId?: string | null
}

const dayText = (iso: string, timeZone: string) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', timeZone }).format(new Date(iso))

/** "Needs you" in the prototype's order: shipping, payments, approval, stock, then couriers. */
export const tasksOf = (home: StoreHome): Task[] => {
  const tasks: Task[] = []
  const t = words.tasks
  if (home.toShip > 0)
    tasks.push({
      kind: 'toShip',
      count: home.toShip,
      title: plural(t.toShip.title, home.toShip),
      body: home.oldestToShipAt ? fill(t.toShip.body, { partly: formatCount(home.partlyShipped), date: dayText(home.oldestToShipAt, home.timeZone) }) : '',
    })
  const collect = home.paymentsToCollect
  if (collect && collect.count > 0) tasks.push({ kind: 'collect', count: collect.count, title: plural(t.collect.title, collect.count), body: t.collect.body, orderId: collect.firstOrderId })
  if (home.awaitingApproval) tasks.push({ kind: 'approval', count: home.awaitingApproval, title: plural(t.approval.title, home.awaitingApproval), body: t.approval.body })
  const low = home.lowStock
  if (low && low.count > 0) {
    // "a, b, c", as the prototype lists them.
    const names = new Intl.ListFormat(locale, { type: 'unit', style: 'short' }).format(low.names)
    tasks.push({ kind: 'lowStock', count: low.count, title: plural(t.lowStock.title, low.count), body: low.count > low.names.length ? fill(t.lowStock.more, { names }) : names })
  }
  const couriers = home.rejectedCouriers ?? []
  if (couriers[0]) tasks.push({ kind: 'courier', count: couriers.length, title: fill(t.courier.title, { name: couriers[0] }), body: t.courier.body })
  return tasks
}

export type SetupKey = 'locale' | 'products' | 'collections' | 'payments' | 'shipping'

export interface SetupItem {
  key: SetupKey
  done: boolean
  note: string | null
}

const languageName = (code: string) => new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code
const countryName = (code: string) => new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code

/**
 * The checklist, only the items the API gave this seat. The locale check has no "confirmed" fact in the API, so it
 * reads as done with what sign-up set, and "Change" opens Settings (decided on #326).
 */
export const setupOf = (home: StoreHome, localeFacts: StoreLocaleFacts | null): SetupItem[] => {
  if (!home.setup || home.hasOrders) return []
  const items: SetupItem[] = []
  if (localeFacts?.country && localeFacts.currency && localeFacts.language)
    items.push({ key: 'locale', done: true, note: fill(words.setup.locale.note, { country: countryName(localeFacts.country), currency: localeFacts.currency, language: languageName(localeFacts.language) }) })
  for (const key of ['products', 'collections', 'payments', 'shipping'] as const) {
    const done = home.setup[key]
    if (done !== null) items.push({ key, done, note: null })
  }
  return items
}

export interface Delta {
  text: string
  tone: 'up' | 'down' | 'muted'
}

/** Each figure with its own change (one a currency), then the card's note. */
export interface NumberCard {
  key: 'sales' | 'orders' | 'average' | 'returning'
  label: string
  figures: { value: string; delta: Delta | null }[]
  note: string | null
}

const pctChange = (now: ApiMoney, before: ApiMoney): number | null => {
  const b = Number(before.amount)
  return b === 0 ? null : Math.round(((Number(now.amount) - b) / b) * 100)
}

/** The numbers row: money only when the API sent it (`reports.read`, ACCESS §5.1), one figure a currency. */
export const numbersOf = (home: StoreHome): NumberCard[] => {
  const n = words.numbers
  const cards: NumberCard[] = []
  const sales = home.sales
  const nothing = [{ value: n.none, delta: null }]
  if (sales) {
    const figures = sales.map((s) => {
      const pct = pctChange(s.yesterday, s.dayBefore)
      const delta: Delta = pct === null ? { text: n.nothingBefore, tone: 'muted' } : { text: fill(pct >= 0 ? n.up : n.down, { pct: formatCount(Math.abs(pct)) }), tone: pct >= 0 ? 'up' : 'down' }
      return { value: moneyText(s.yesterday), delta }
    })
    cards.push({ key: 'sales', label: n.salesYesterday, figures: figures.length > 0 ? figures : nothing, note: null })
  }
  cards.push({ key: 'orders', label: n.ordersToday, figures: [{ value: formatCount(home.ordersToday), delta: null }], note: fill(n.ordersYesterday, { count: formatCount(home.ordersYesterday) }) })
  if (sales) {
    const averages = sales.flatMap((s) => (s.averageWeek ? [{ value: moneyText(s.averageWeek), delta: null }] : []))
    cards.push({ key: 'average', label: n.average, figures: averages.length > 0 ? averages : nothing, note: n.averageNote })
  }
  if (home.returningCustomers !== null) cards.push({ key: 'returning', label: n.returning, figures: [{ value: formatCount(home.returningCustomers), delta: null }], note: n.returningNote })
  return cards
}

/** "Good morning" by the hour in the store's own zone. */
export const greetingOf = (name: string, timeZone: string, now: Date): string => {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(now))
  return fill(hour < 12 ? words.greeting.morning : hour < 18 ? words.greeting.afternoon : words.greeting.evening, { name })
}

export const dateLineOf = (store: string, timeZone: string, now: Date): string =>
  fill(words.dateLine, { date: new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone }).format(now), store })
