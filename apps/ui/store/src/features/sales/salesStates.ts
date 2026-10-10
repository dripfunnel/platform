import type { Sale } from '../../api/sales'

// Your sales' states under ?state= (ui/README.md §6): loading, error, sales, empty, readOnly, denied.
export const salesStates = ['loading', 'error', 'sales', 'empty', 'readOnly', 'denied'] as const
export type SalesState = (typeof salesStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const sale = (lineId: string, orderNumber: string, placedAt: string, name: string, versionName: string | null, quantity: number, amount: string, over: Partial<Sale> = {}): Sale => ({
  lineId,
  orderNumber,
  placedAt,
  orderState: 'placed',
  name,
  versionName,
  sku: null,
  quantity,
  refundedQuantity: 0,
  amount: { amount, currency: 'INR' },
  ...over,
})

// The prototype's five lines, as `mySales` answers them.
const rows: Sale[] = harness
  ? [
      sale('l1049', 'KT-1049', '2026-10-04T06:10:00.000Z', 'Mara Linen Shirt', 'M', 1, '269900'),
      sale('l1046', 'KT-1046', '2026-10-03T09:40:00.000Z', 'Linen Tote', null, 2, '349900', { refundedQuantity: 1 }),
      sale('l1041', 'KT-1041', '2026-10-01T12:05:00.000Z', 'Mara Linen Shirt', 'S', 1, '269900'),
      sale('l1037', 'KT-1037', '2026-09-28T07:30:00.000Z', 'Linen Tote', null, 1, '174900', { orderState: 'cancelled' }),
      sale('l1033', 'KT-1033', '2026-09-25T15:20:00.000Z', 'Mara Linen Shirt', 'L', 1, '269900', { refundedQuantity: 1 }),
    ]
  : []

export const salesSample = (state: SalesState | null): Sale[] | null => {
  if (!harness || !state || state === 'loading' || state === 'error' || state === 'denied') return null
  return state === 'empty' ? [] : rows
}
