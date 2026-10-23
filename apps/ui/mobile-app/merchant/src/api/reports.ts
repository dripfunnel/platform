import { z } from 'zod'
import { isApiError, typedQuery, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { exportJobFields, exportJobSchema, readExportJob, type ExportJob } from './exportJob'
import { moneySchema } from './orders'

// Reports on the Store API (FIRST-RELEASE (store) §10; apps/api src/apis/store/reports.ts, reportExports.ts): the last 7, 30 or 90 days
// against as many before, in one currency at a time, each panel's file as a job, and the custom report builder, which is the same job.

export const reportDays = [7, 30, 90] as const
export type ReportDays = (typeof reportDays)[number]

/** The ranked panels' rows, as the prototype's cards list them. */
const panelTop = 5

const reportSchema = z.object({
  days: z.number().int(),
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
export const loadReport = async (client: ApiClient, days: ReportDays, currency: string | null): Promise<StoreReport | null> => {
  const { report, storeInfo } = await typedQuery(client)(
    `query Report($days: Int!, $currency: String, $top: Int) { report(days: $days, currency: $currency) { days currency currencies
      takings { orders sales { amount currency } refunds { amount currency } net { amount currency } previousNet { amount currency } previousOrders }
      sold(first: $top) { productId name units amount { amount currency } }
      markets(first: $top) { marketId name orders amount { amount currency } }
      tax { by total { amount currency } rows { key orders amount { amount currency } } }
      offers(first: $top) { name orders discount { amount currency } amount { amount currency } } }
    storeInfo { country } }`,
    z.object({ report: reportSchema.nullable(), storeInfo: z.object({ country: z.string().nullable() }).nullable() }),
    { days, currency, top: panelTop },
  )
  return report && { ...report, country: storeInfo?.country ?? null }
}

const suppliersSchema = z.array(z.object({ supplierId: z.string().nullable(), name: z.string().nullable(), units: z.number().int() }))
export type ReportSuppliers = z.infer<typeof suppliersSchema>

/** Its own read: the supplier panel has its own plan switch (`reports_export`), refused as PLAN_LIMIT on its own. */
export const loadReportSuppliers = async (client: ApiClient, days: ReportDays, currency: string | null): Promise<ReportSuppliers> =>
  (
    await typedQuery(client)(
      'query Suppliers($days: Int!, $currency: String) { report(days: $days, currency: $currency) { suppliers { supplierId name units } } }',
      z.object({ report: z.object({ suppliers: suppliersSchema }).nullable() }),
      { days, currency },
    )
  ).report?.suppliers ?? []

export type ReportPanel = 'takings' | 'sold' | 'markets' | 'tax' | 'suppliers' | 'offers' | 'custom'

/** The builder's two answers (apps/api src/engine/modules/reports/exports.ts `customColumns`). */
export const customColumns = { orders: ['basic', 'tax', 'lines'], products: ['basic', 'stock'], customers: ['basic', 'groups'] } as const
export type CustomRows = keyof typeof customColumns
export const customRows = Object.keys(customColumns) as CustomRows[]
export type CustomReport = { rows: CustomRows; columns: string }

/** A panel's file over the range and currency on screen, as a job; answers the job's id. */
export const requestReportExport = async (client: ApiClient, panel: ReportPanel, days: ReportDays, currency: string, custom: CustomReport | null): Promise<string> =>
  (
    await typedQuery(client)(
      'mutation ExportReport($panel: ReportPanel!, $days: Int!, $currency: String, $custom: CustomReportInput) { exportReport(panel: $panel, days: $days, currency: $currency, custom: $custom) }',
      z.object({ exportReport: z.string() }),
      { panel, days, currency, custom },
    )
  ).exportReport

export const loadReportExport = async (client: ApiClient, id: string): Promise<ExportJob | null> =>
  readExportJob(
    (await typedQuery(client)(`query ReportExport($id: ID!) { reportExport(id: $id) { ${exportJobFields} } }`, z.object({ reportExport: exportJobSchema.nullable() }), { id })).reportExport,
  )

const unlockSchema = z.object({ name: z.string() })

/**
 * The plan a PLAN_LIMIT names (`unlockedBy`, apps/api src/apis/store/refusals.ts), or null when it names none; undefined when the error
 * is not a plan limit at all.
 */
export const planOf = (error: unknown): string | null | undefined => {
  if (!isApiError(error, 'PLAN_LIMIT')) return undefined
  const plan = unlockSchema.safeParse(error.details['unlockedBy'])
  return plan.success ? plan.data.name : null
}
