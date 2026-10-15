import type { OrderLine, OrderPart } from '../../api/order'
import { t } from '../../messages'

// Quantities picked per line in the ship, return and refund sheets.
export type Picks = Readonly<Record<string, number>>
export type PickRow = { line: OrderLine; part: OrderPart; max: number }

/** The picks above none, as the lines the API takes. */
export const pickedLines = (picks: Picks): { lineId: string; quantity: number }[] =>
  Object.entries(picks)
    .filter(([, quantity]) => quantity > 0)
    .map(([lineId, quantity]) => ({ lineId, quantity }))

export const pickedCount = (picks: Picks): number => Object.values(picks).reduce((total, quantity) => total + quantity, 0)

/** "{Supplier} packs these" under a supplier's line; nothing under the store's own. */
export const supplierSub = (row: PickRow): string | null => (row.part.supplierName ? t('orders.detail.groups.supplier', { supplier: row.part.supplierName }) : null)
