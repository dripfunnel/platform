import { storeRoleHas } from '#auth/storePermissions'
import { createHomeService, type HomeSales, type HomeView } from '#engine/modules/reports/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { moneyType, type StoreBuilder } from './builder'

// Home (FIRST-RELEASE §5, PortalHome): the merchant side's landing screen, refused to suppliers (§19). What a seat
// may not see is null, decided on the server (engine/modules/reports/home.ts).

type HomeOrder = HomeView['latestOrders'][number]
type Setup = NonNullable<HomeView['setup']>

export const registerHome = (builder: StoreBuilder) => {
  const Money = moneyType(builder)
  const at = (value: Date | null) => (value ? value.toISOString() : null)

  const Collect = builder.objectRef<NonNullable<HomeView['toCollect']>>('HomePaymentsToCollect').implement({
    fields: (t) => ({ count: t.exposeInt('count'), firstOrderId: t.exposeID('firstOrderId', { nullable: true }) }),
  })
  const LowStock = builder.objectRef<NonNullable<HomeView['lowStock']>>('HomeLowStock').implement({
    fields: (t) => ({ count: t.exposeInt('count'), names: t.exposeStringList('names') }),
  })
  const Sales = builder.objectRef<HomeSales>('HomeSales').implement({
    fields: (t) => ({
      yesterday: t.field({ type: Money, resolve: (s) => ({ amount: s.yesterday, currency: s.currency }) }),
      dayBefore: t.field({ type: Money, resolve: (s) => ({ amount: s.dayBefore, currency: s.currency }) }),
      // The average sale over the last seven days, today included; null with none.
      averageWeek: t.field({ type: Money, nullable: true, resolve: (s) => (s.averageWeek === null ? null : { amount: s.averageWeek, currency: s.currency }) }),
    }),
  })
  const Order = builder.objectRef<HomeOrder>('HomeOrder').implement({
    fields: (t) => ({
      id: t.exposeID('id'),
      number: t.exposeString('number'),
      placedAt: t.string({ resolve: (o) => o.placed_at.toISOString() }),
      state: t.exposeString('state'),
      paymentState: t.exposeString('payment_state', { nullable: true }),
      fulfilmentState: t.exposeString('fulfilment_state', { nullable: true }),
      customerName: t.exposeString('customer_name', { nullable: true }),
      items: t.exposeInt('items'),
      total: t.field({ type: Money, nullable: true, resolve: (o) => (o.total_amount === null ? null : { amount: o.total_amount, currency: o.currency }) }),
      test: t.exposeBoolean('test', { nullable: true }),
    }),
  })
  const SetupType = builder.objectRef<Setup>('HomeSetup').implement({
    fields: (t) => ({
      products: t.exposeBoolean('products', { nullable: true }),
      collections: t.exposeBoolean('collections', { nullable: true }),
      payments: t.exposeBoolean('payments', { nullable: true }),
      shipping: t.exposeBoolean('shipping', { nullable: true }),
    }),
  })
  const Home = builder.objectRef<HomeView>('StoreHome').implement({
    fields: (t) => ({
      // The zone "today" and "yesterday" are days in.
      timeZone: t.exposeString('timeZone'),
      hasOrders: t.exposeBoolean('hasOrders'),
      toShip: t.exposeInt('toShip'),
      partlyShipped: t.exposeInt('partlyShipped'),
      oldestToShipAt: t.string({ nullable: true, resolve: (h) => at(h.oldestToShipAt) }),
      paymentsToCollect: t.field({ type: Collect, nullable: true, resolve: (h) => h.toCollect }),
      awaitingApproval: t.exposeInt('awaitingApproval', { nullable: true }),
      lowStock: t.field({ type: LowStock, nullable: true, resolve: (h) => h.lowStock }),
      rejectedCouriers: t.exposeStringList('rejectedCouriers', { nullable: true }),
      ordersToday: t.exposeInt('ordersToday'),
      ordersYesterday: t.exposeInt('ordersYesterday'),
      sales: t.field({ type: [Sales], nullable: true, resolve: (h) => h.sales }),
      returningCustomers: t.exposeInt('returningCustomers', { nullable: true }),
      latestOrders: t.field({ type: [Order], resolve: (h) => h.latestOrders }),
      setup: t.field({ type: SetupType, nullable: true, resolve: (h) => h.setup }),
    }),
  })

  builder.queryFields((t) => ({
    home: t.field({
      type: Home,
      nullable: true,
      extensions: { access: { api: 'store', scope: 'store', permission: 'orders.read', target: 'none' } },
      resolve: (_, __, ctx: StoreContext) => {
        if (!ctx.sql) throw forbidden()
        const caller = actingCaller(ctx)
        return createHomeService({ sql: ctx.sql, context: caller.context, has: (p) => storeRoleHas(caller.role, p), now: ctx.now }).read()
      },
    }),
  }))
}
