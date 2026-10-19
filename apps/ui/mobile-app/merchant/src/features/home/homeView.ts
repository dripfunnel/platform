import type { HomeOrder, LocaleFacts, StoreHome } from '../../api/home'
import { formatDay, formatList, formatMoney, formatNumber, formatWeekdayDate, hourIn, languageName, regionName } from '../../format'
import { locale, t } from '../../messages'
import { tCount } from '../../messages/plural'
import type { Seat } from '../../nav'
import { merchantStatus } from '../orders/orderView'
import { newProductHref } from '../products/routes'
import { settingsTabHref } from '../settings/routes'
import { catalogueHref, ordersToShipHref, productsFilterHref } from './routes'

// How Home words the API's `home` (DESIGN.md §3; FIRST-RELEASE (store) §5). Every count and sum is the API's, and a figure a seat may
// not see arrives as null and is left out. Nothing here adds up a total.

/** homeApp for a store with activity, PortalHome for a new one (decided on #509): an order, or a product the seat is told of, makes it active. */
export const isActiveStore = (home: StoreHome): boolean => home.hasOrders || home.setup?.products === true

export type Need = { key: 'toShip' | 'approval' | 'lowStock'; count: number; label: string; sub: string; href: string }

/** "Needs you", in the prototype's order: orders to ship, products to approve, low on stock; each opens its filtered list. */
export const needsOf = (home: StoreHome): Need[] => {
  const needs: Need[] = []
  if (home.toShip > 0) {
    const date = home.oldestToShipAt ? formatDay(home.oldestToShipAt, locale, home.timeZone) : null
    const sub = date === null ? '' : home.partlyShipped > 0 ? t('home.need.toShip.partly', { partly: formatNumber(home.partlyShipped, locale), date }) : t('home.need.toShip.oldest', { date })
    needs.push({ key: 'toShip', count: home.toShip, label: t('home.need.toShip.label'), sub, href: ordersToShipHref })
  }
  if (home.awaitingApproval !== null && home.awaitingApproval > 0) {
    needs.push({ key: 'approval', count: home.awaitingApproval, label: t('home.need.approval.label'), sub: t('home.need.approval.sub'), href: productsFilterHref('pending') })
  }
  const low = home.lowStock
  if (low !== null && low.count > 0) {
    const names = formatList(low.names, locale)
    needs.push({ key: 'lowStock', count: low.count, label: t('home.need.lowStock.label'), sub: low.count > low.names.length ? t('home.need.lowStock.more', { names }) : names, href: productsFilterHref('low_stock') })
  }
  return needs
}

export type Headline = { label: string; figures: string[]; sub: string }

/**
 * The big number. The API has no figure for today's sales, so a seat with money reads yesterday's, a figure a currency (decided on #509);
 * a seat without money reads today's orders, as the web's Home does.
 */
export const headlineOf = (home: StoreHome): Headline => {
  if (home.sales === null) {
    return { label: t('home.sales.today'), figures: [formatNumber(home.ordersToday, locale)], sub: t('home.orders.yesterday', { count: formatNumber(home.ordersYesterday, locale) }) }
  }
  const figures = home.sales.map((sales) => formatMoney(sales.yesterday, locale))
  return { label: t('home.sales.yesterday'), figures: figures.length > 0 ? figures : [t('home.sales.none')], sub: tCount('home.orders.today', home.ordersToday) }
}

/** The order's status words and tone come from Orders, so a row reads the same on both screens. */
export const orderStatusOf = (order: HomeOrder) => merchantStatus(order.state, order.paymentState, order.fulfilmentState)

export type SetupKey = 'locale' | 'products' | 'collections' | 'payments' | 'shipping'
export type SetupItem = { key: SetupKey; done: boolean; note: string | null; href: string }

/**
 * The checklist while the store has no order, only the items the API gave this seat. The locale line has no "confirmed" fact behind it,
 * so it reads as done with what sign-up set, and Change opens Settings › Store info (as the web's Home does); it is the Owner's (`settings`).
 */
export const setupOf = (home: StoreHome, facts: LocaleFacts | null, canSettings: boolean, seat: Seat | null): SetupItem[] => {
  if (home.setup === null || home.hasOrders) return []
  const items: SetupItem[] = []
  if (canSettings && facts !== null) {
    const note = t('home.setup.locale.note', { country: regionName(facts.country, locale), currency: facts.currency, language: languageName(facts.language, locale) })
    items.push({ key: 'locale', done: true, note, href: settingsTabHref('store') })
  }
  const hrefs = { products: newProductHref(seat), collections: catalogueHref, payments: settingsTabHref('payments'), shipping: settingsTabHref('shipping') } as const
  for (const key of ['products', 'collections', 'payments', 'shipping'] as const) {
    const done = home.setup[key]
    if (done !== null) items.push({ key, done, note: null, href: hrefs[key] })
  }
  return items
}

export const setupCount = (items: readonly SetupItem[]): { done: number; total: number } => ({ done: items.filter((item) => item.done).length, total: items.length })

/** "Good morning" by the hour in the store's own zone, with the person's first name when there is one. */
export const greetingOf = (name: string | null, timeZone: string, now: Date): string => {
  const hour = hourIn(now, timeZone)
  const greeting = t(hour < 12 ? 'home.greeting.morning' : hour < 18 ? 'home.greeting.afternoon' : 'home.greeting.evening')
  const first = name?.trim().split(/\s+/)[0]
  return first ? t('home.greeting.named', { greeting, name: first }) : greeting
}

export const dateLineOf = (store: string, timeZone: string, now: Date): string => t('home.dateLine', { date: formatWeekdayDate(now, locale, timeZone), store })
