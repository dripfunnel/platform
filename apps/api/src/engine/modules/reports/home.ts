import type postgres from 'postgres'
import type { StorePermission } from '#auth/storePermissions'
import type { TenantContext } from '#core/tenancy'
import { approvalRequired, countAwaitingApproval } from '#db/scoped/approval'
import { withScope } from '#db/scoped/index'
import {
  countReturningCustomers,
  selectDayFigures,
  selectLowStock,
  selectOrderTasks,
  selectRejectedCouriers,
  selectSetup,
  selectStoreDays,
} from '#db/scoped/storeHome'
import { selectMerchantOrders, type OrderListRow } from '#db/scoped/storeOrders'

// Home (FIRST-RELEASE §5, §20 SAPI 18), withheld per seat on the server: a field a seat may not have (ACCESS §5.1) is
// null, never zero.

/** The latest orders and the low-stock names Home lists. */
export const homeLatestOrders = 5
export const homeLowStockNames = 3

export interface HomeSales {
  currency: string
  yesterday: string
  dayBefore: string
  averageWeek: string | null
}

export interface HomeView {
  timeZone: string
  hasOrders: boolean
  toShip: number
  partlyShipped: number
  oldestToShipAt: Date | null
  toCollect: { count: number; firstOrderId: string | null } | null
  awaitingApproval: number | null
  lowStock: { count: number; names: string[] } | null
  rejectedCouriers: string[] | null
  ordersToday: number
  ordersYesterday: number
  /** A row a currency sold in this week, the pricing currency first. */
  sales: HomeSales[] | null
  returningCustomers: number | null
  /** Each order's total is null for a seat without money. */
  latestOrders: (OrderListRow & { total_amount: string | null })[]
  /** The getting-started checklist while the store has no order; an item is null for a seat that can't do it. */
  setup: { products: boolean | null; collections: boolean | null; payments: boolean | null; shipping: boolean | null } | null
}

export interface HomeDeps {
  sql: postgres.Sql
  context: TenantContext
  /** What the acting seat holds (auth/storePermissions). */
  has: (permission: StorePermission) => boolean
  now: () => Date
}

export const createHomeService = ({ sql, context, has, now }: HomeDeps) => {
  const { storeId } = context
  const money = has('reports.read')
  const only = <T>(allowed: boolean, value: T): T | null => (allowed ? value : null)

  const read = (): Promise<HomeView | null> =>
    withScope(sql, context, async (tx) => {
      const days = await selectStoreDays(tx, storeId, now())
      if (!days) return null
      const tasks = await selectOrderTasks(tx, storeId)
      const figures = await selectDayFigures(tx, storeId, days)
      const sales = figures
        .map((f) => ({ currency: f.currency, yesterday: f.sales_yesterday, dayBefore: f.sales_day_before, averageWeek: f.average_week }))
        .sort((a, b) => Number(b.currency === days.pricing_currency) - Number(a.currency === days.pricing_currency) || a.currency.localeCompare(b.currency))
      const latest = await selectMerchantOrders(tx, storeId, 'all', null, { limit: homeLatestOrders, after: null, before: null })
      const setup = await selectSetup(tx, storeId)
      return {
        timeZone: days.time_zone,
        hasOrders: tasks.any_order,
        toShip: tasks.to_ship,
        partlyShipped: tasks.partly_shipped,
        oldestToShipAt: tasks.oldest_to_ship,
        toCollect: only(has('orders.mark_paid'), { count: tasks.to_collect, firstOrderId: tasks.first_to_collect }),
        awaitingApproval: has('approve') && (await approvalRequired(tx)) ? await countAwaitingApproval(tx, storeId) : null,
        lowStock: has('stock.read') ? await selectLowStock(tx, storeId, homeLowStockNames) : null,
        rejectedCouriers: has('shipping.configure') ? await selectRejectedCouriers(tx, storeId) : null,
        ordersToday: figures.reduce((n, f) => n + f.orders_today, 0),
        ordersYesterday: figures.reduce((n, f) => n + f.orders_yesterday, 0),
        sales: only(money, sales),
        returningCustomers: money ? await countReturningCustomers(tx, storeId) : null,
        latestOrders: latest.slice(0, homeLatestOrders).map((o) => ({ ...o, total_amount: money ? o.total_amount : null })),
        setup: tasks.any_order
          ? null
          : {
              products: only(has('catalog.write'), setup.products),
              collections: only(has('catalog.write'), setup.collections),
              payments: only(has('payments.configure'), setup.payments),
              shipping: only(has('shipping.configure'), setup.shipping),
            },
      }
    })

  return { read }
}
