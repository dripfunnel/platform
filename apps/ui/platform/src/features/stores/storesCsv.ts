import { csv } from '@dripfunnel/shared/format'
import type { StoreRow } from '../../api/stores'
import { formatAmount, messages } from '../../messages'

const words = messages.stores
const columns = words.export.columns

// The export's columns (FIRST-RELEASE.md §6.1): the account only, never an order, customer or product.
export const storesCsv = (rows: readonly StoreRow[]): string =>
  csv([
    [columns.store, columns.code, columns.owner, columns.ownerEmail, columns.plan, columns.status, columns.sales, columns.currency, columns.storefront, columns.domain, columns.created],
    ...rows.map((row) => [
      row.name,
      row.code,
      row.owner.name,
      row.owner.email,
      row.plan.name,
      words.statuses[row.state.kind],
      row.salesLastMonth ? formatAmount(row.salesLastMonth) : '',
      row.salesLastMonth?.currency ?? '',
      words.storefronts[row.storefront],
      row.domain.host,
      row.createdAt.slice(0, 10),
    ]),
  ])
