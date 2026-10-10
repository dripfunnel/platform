import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from '@dripfunnel/shared/graphql'
import { z } from 'zod'
import { query } from './client'
import { moneySchema } from './orders'

// Reports (FIRST-RELEASE §10, PortalReports; apps/api/schema/store.graphql, src/apis/store/reports.ts, reportExports.ts):
// a report of 7, 30 or 90 days in one currency, each panel's file as a job, and the custom report builder.

export const reportDays = [7, 30, 90] as const
export type ReportDays = (typeof reportDays)[number]

/** The ranked panels' rows, as the prototype's cards list them. */
export const reportTop = 5

const reportSchema = z.object({
  days: z.number().int(),
  timeZone: z.string(),
  currency: z.string().nullable(),
  currencies: z.array(z.string()),
  takings: z.object({ orders: z.number().int(), sales: moneySchema, refunds: moneySchema, net: moneySchema, previousNet: moneySchema, previousOrders: z.number().int() }).nullable(),
  sold: z.array(z.object({ productId: z.string(), name: z.string(), units: z.number().int(), amount: moneySchema })),
  markets: z.array(z.object({ marketId: z.string().nullable(), name: z.string().nullable(), orders: z.number().int(), amount: moneySchema })),
  tax: z.object({ by: z.enum(['state', 'rate']), total: moneySchema, rows: z.array(z.object({ key: z.string().nullable(), orders: z.number().int(), amount: moneySchema })) }).nullable(),
  offers: z.array(z.object({ name: z.string(), orders: z.number().int(), discount: moneySchema, amount: moneySchema })),
})
export type StoreReport = z.infer<typeof reportSchema> & { country: string | null }

/** With the store's country, which names its tax (GST in India, sales tax in the US). */
export const loadReport = async (days: ReportDays, currency: string | null): Promise<StoreReport | null> => {
  const { report, storeInfo } = await query(
    `query R($d: Int!, $c: String, $top: Int) { report(days: $d, currency: $c) { days timeZone currency currencies
      takings { orders sales { amount currency } refunds { amount currency } net { amount currency } previousNet { amount currency } previousOrders }
      sold(first: $top) { productId name units amount { amount currency } }
      markets(first: $top) { marketId name orders amount { amount currency } }
      tax { by total { amount currency } rows { key orders amount { amount currency } } }
      offers(first: $top) { name orders discount { amount currency } amount { amount currency } } }
    storeInfo { country } }`,
    z.object({ report: reportSchema.nullable(), storeInfo: z.object({ country: z.string().nullable() }).nullable() }),
    { d: days, c: currency, top: reportTop },
  )
  return report && { ...report, country: storeInfo?.country ?? null }
}

const suppliersSchema = z.array(z.object({ supplierId: z.string().nullable(), name: z.string().nullable(), units: z.number().int() }))
export type ReportSuppliers = z.infer<typeof suppliersSchema>

/** Its own request: the supplier panel has its own plan switch (`reports_export`), refused as PLAN_LIMIT on its own. */
export const loadReportSuppliers = async (days: ReportDays, currency: string | null): Promise<ReportSuppliers> =>
  (await query('query S($d: Int!, $c: String) { report(days: $d, currency: $c) { suppliers { supplierId name units } } }', z.object({ report: z.object({ suppliers: suppliersSchema }).nullable() }), { d: days, c: currency })).report?.suppliers ?? []

export type ReportPanel = 'takings' | 'sold' | 'markets' | 'tax' | 'suppliers' | 'offers' | 'custom'

/** The builder's two answers (src/engine/modules/reports/exports.ts `customColumns`). */
export const customColumns = { orders: ['basic', 'tax', 'lines'], products: ['basic', 'stock'], customers: ['basic', 'groups'] } as const
export type CustomRows = keyof typeof customColumns
export const customRows = Object.keys(customColumns) as CustomRows[]
export const customReportSchema = z.discriminatedUnion('rows', [
  z.object({ rows: z.literal('orders'), columns: z.enum(customColumns.orders) }),
  z.object({ rows: z.literal('products'), columns: z.enum(customColumns.products) }),
  z.object({ rows: z.literal('customers'), columns: z.enum(customColumns.customers) }),
])
export type CustomReport = z.infer<typeof customReportSchema>

export const loadReportExport = async (id: string): Promise<ExportJob | null> =>
  readExportJob((await query(`query E($id: ID!) { reportExport(id: $id) { ${exportJobFields} } }`, z.object({ reportExport: exportJobSchema.nullable() }), { id })).reportExport)

/** A panel's file over the range and currency on screen, as a job the shell's watcher follows. */
export const requestReportExport = async (panel: ReportPanel, days: ReportDays, currency: string | null, custom: CustomReport | null = null): Promise<ExportJob> => {
  const { exportReport: id } = await query(
    'mutation E($p: ReportPanel!, $d: Int!, $c: String, $x: CustomReportInput) { exportReport(panel: $p, days: $d, currency: $c, custom: $x) }',
    z.object({ exportReport: z.string() }),
    { p: panel, d: days, c: currency, x: custom },
  )
  return { id, state: 'preparing', entries: null, url: null, expiresAt: null }
}
