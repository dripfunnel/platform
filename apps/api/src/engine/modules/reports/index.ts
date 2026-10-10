// Home and Reports (FIRST-RELEASE §5, §10): the merchant side's figures, read in the store's own scope.

export { createHomeService, homeLatestOrders, homeLowStockNames, type HomeSales, type HomeView } from './home'
export {
  createReportsService,
  isReportDays,
  reportRanges,
  type ReportDays,
  type ReportResult,
  type ReportView,
} from './reports'
export type { MarketRow, OfferRow, SoldRow, SupplierUnitsRow, TakingsRow, TaxRow } from '#db/scoped/storeReports'
export {
  buildReportExport,
  createReportExportService,
  customColumns,
  customRows,
  reportExportAudit,
  reportPanels,
  type CustomReport,
  type CustomRows,
  type ReportPanel,
} from './exports'
