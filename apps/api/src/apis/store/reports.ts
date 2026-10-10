import { GraphQLError } from 'graphql'
import {
  createReportsService,
  type MarketRow,
  type OfferRow,
  type ReportView,
  type SoldRow,
  type SupplierUnitsRow,
  type TakingsRow,
  type TaxRow,
} from '#engine/modules/reports/index'
import { forbidden } from '../graphql/scope'
import { actingCaller, type StoreContext } from './access'
import { moneyType, type StoreBuilder } from './builder'
import { requirePlan, storePageSize } from './refusals'

// Reports (FIRST-RELEASE §10, PortalReports): Owner and Manager (`reports.read`), never Staff or a supplier, which reads
// Your sales instead (§17). Locked below Growth (`reports_sales`); the supplier panel comes with export (`reports_export`).

/** The panels' top rows by default: what the prototype's cards list. */
const defaultTop = 5

export const registerReports = (builder: StoreBuilder) => {
  const Money = moneyType(builder)
  const service = (ctx: StoreContext) => {
    if (!ctx.sql) throw forbidden()
    return createReportsService({ sql: ctx.sql, context: actingCaller(ctx).context, now: ctx.now })
  }
  const plan = (ctx: StoreContext, key: 'reports_sales' | 'reports_export') => {
    if (!ctx.sql) throw forbidden()
    return requirePlan(ctx.sql, actingCaller(ctx).context, { key }, ctx.now())
  }
  const top = (first: number | null | undefined) => Math.min(Math.max(Math.floor(first ?? defaultTop), 1), storePageSize)
  // A panel's rows carry the report's currency: a report has none only when it sold nothing, so it has no rows either.
  type Panel<T> = { currency: string; row: T }
  const of = <T>(report: ReportView, rows: T[]): Panel<T>[] => {
    const { currency } = report
    return currency === null ? [] : rows.map((row) => ({ currency, row }))
  }
  const one = <T>(report: ReportView, row: T | null): Panel<T> | null => (row === null ? null : (of(report, [row])[0] ?? null))
  const money = (p: { currency: string }, amount: string) => ({ amount, currency: p.currency })

  const Takings = builder.objectRef<Panel<TakingsRow>>('ReportTakings').implement({
    fields: (t) => ({
      orders: t.int({ resolve: ({ row }) => row.orders }),
      sales: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, row.sales) }),
      refunds: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, row.refunds) }),
      // What reaches the bank: sales less refunds.
      net: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, (BigInt(row.sales) - BigInt(row.refunds)).toString()) }),
      previousNet: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, row.previous_net) }),
      previousOrders: t.int({ resolve: ({ row }) => row.previous_orders }),
    }),
  })
  const Sold = builder.objectRef<Panel<SoldRow>>('ReportProduct').implement({
    fields: (t) => ({
      productId: t.id({ resolve: ({ row }) => row.product_id }),
      name: t.string({ resolve: ({ row }) => row.name }),
      units: t.int({ resolve: ({ row }) => row.units }),
      amount: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, row.amount) }),
    }),
  })
  const Market = builder.objectRef<Panel<MarketRow>>('ReportMarket').implement({
    fields: (t) => ({
      // Null for orders placed outside every market.
      marketId: t.id({ nullable: true, resolve: ({ row }) => row.market_id }),
      name: t.string({ nullable: true, resolve: ({ row }) => row.name }),
      orders: t.int({ resolve: ({ row }) => row.orders }),
      amount: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, row.amount) }),
    }),
  })
  const TaxLine = builder.objectRef<Panel<TaxRow>>('ReportTaxLine').implement({
    fields: (t) => ({
      // A US state, or a rate in basis points; null for tax on what no line carries (delivery) or an address without a state.
      key: t.string({ nullable: true, resolve: ({ row }) => row.key }),
      orders: t.int({ resolve: ({ row }) => row.orders }),
      amount: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, row.amount) }),
    }),
  })
  const Tax = builder.objectRef<Panel<{ by: ReportView['taxBy']; total: string; rows: TaxRow[] }>>('ReportTax').implement({
    fields: (t) => ({
      // state or rate
      by: t.string({ resolve: ({ row }) => row.by }),
      total: t.field({ type: Money, resolve: (p) => money(p, p.row.total) }),
      rows: t.field({ type: [TaxLine], resolve: ({ currency, row }) => row.rows.map((r) => ({ currency, row: r })) }),
    }),
  })
  const Supplier = builder.objectRef<Panel<SupplierUnitsRow>>('ReportSupplier').implement({
    fields: (t) => ({
      // Null for the store's own products.
      supplierId: t.id({ nullable: true, resolve: ({ row }) => row.seller_id }),
      name: t.string({ nullable: true, resolve: ({ row }) => row.name }),
      units: t.int({ resolve: ({ row }) => row.units }),
    }),
  })
  const Offer = builder.objectRef<Panel<OfferRow>>('ReportOffer').implement({
    fields: (t) => ({
      // The offer's name as shoppers saw it on their order.
      name: t.string({ resolve: ({ row }) => row.label }),
      orders: t.int({ resolve: ({ row }) => row.orders }),
      discount: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, row.discount) }),
      amount: t.field({ type: Money, resolve: ({ currency, row }) => money({ currency }, row.amount) }),
    }),
  })

  const Report = builder.objectRef<ReportView>('StoreReport').implement({
    fields: (t) => ({
      days: t.int({ resolve: (r) => r.days }),
      timeZone: t.exposeString('timeZone'),
      from: t.string({ resolve: (r) => r.from.toISOString() }),
      to: t.string({ resolve: (r) => r.to.toISOString() }),
      // The period before, compared with: previousFrom up to from.
      previousFrom: t.string({ resolve: (r) => r.previousFrom.toISOString() }),
      currency: t.exposeString('currency', { nullable: true }),
      currencies: t.exposeStringList('currencies'),
      takings: t.field({ type: Takings, nullable: true, resolve: async (r, _, ctx) => one(r, await service(ctx).takings(r)) }),
      sold: t.field({ type: [Sold], args: { first: t.arg.int() }, resolve: async (r, args, ctx) => of(r, await service(ctx).sold(r, top(args.first))) }),
      markets: t.field({ type: [Market], args: { first: t.arg.int() }, resolve: async (r, args, ctx) => of(r, await service(ctx).markets(r, top(args.first))) }),
      tax: t.field({ type: Tax, nullable: true, resolve: async (r, _, ctx) => { const tax = await service(ctx).tax(r); return one(r, tax && { by: r.taxBy, ...tax }) } }),
      suppliers: t.field({
        type: [Supplier],
        resolve: async (r, _, ctx) => {
          await plan(ctx, 'reports_export')
          return of(r, await service(ctx).suppliers(r))
        },
      }),
      offers: t.field({ type: [Offer], args: { first: t.arg.int() }, resolve: async (r, args, ctx) => of(r, await service(ctx).offers(r, top(args.first))) }),
    }),
  })

  builder.queryFields((t) => ({
    // days is 7, 30 or 90; currency one the store sells in, its pricing currency by default.
    report: t.field({
      type: Report,
      args: { days: t.arg.int({ required: true }), currency: t.arg.string() },
      extensions: { access: { api: 'store', scope: 'store', permission: 'reports.read', target: 'none' } },
      resolve: async (_, args, ctx) => {
        await plan(ctx, 'reports_sales')
        const result = await service(ctx).open(args.days, args.currency?.toUpperCase() ?? null)
        if (!result.ok) throw new GraphQLError('Pick 7, 30 or 90 days.', { extensions: { code: result.reason } })
        return result.value
      },
    }),
  }))
}
