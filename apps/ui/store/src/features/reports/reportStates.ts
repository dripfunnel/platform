import type { ReportSuppliers, StoreReport } from '../../api/reports'

// Reports' states under ?state= (ui/README.md §6): loading, error, report, thin, empty, us, locked, lockedManager,
// exportLocked, readOnly, denied.
export const reportStates = ['loading', 'error', 'report', 'thin', 'empty', 'us', 'locked', 'lockedManager', 'exportLocked', 'readOnly', 'denied'] as const
export type ReportState = (typeof reportStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const inr = (amount: string) => ({ amount, currency: 'INR' })
const usd = (amount: string) => ({ amount, currency: 'USD' })

const india: StoreReport | null = harness
  ? {
      days: 30,
      timeZone: 'Asia/Kolkata',
      currency: 'INR',
      currencies: ['INR', 'USD'],
      country: 'IN',
      takings: { orders: 42, sales: inr('18452000'), refunds: inr('612000'), net: inr('17840000'), previousNet: inr('15210000'), previousOrders: 37 },
      sold: [
        { productId: 'p1', name: 'Banarasi silk saree', units: 14, amount: inr('6986000') },
        { productId: 'p2', name: 'Block-print kurta', units: 31, amount: inr('4619000') },
        { productId: 'p3', name: 'Kantha throw', units: 9, amount: inr('2241000') },
        { productId: 'p4', name: 'Handloom dupatta', units: 12, amount: inr('1428000') },
        { productId: 'p5', name: 'Linen cushion cover', units: 18, amount: inr('882000') },
      ],
      markets: [
        { marketId: 'm1', name: 'India', orders: 38, amount: inr('15912000') },
        { marketId: 'm2', name: 'United States', orders: 3, amount: inr('1620000') },
        { marketId: null, name: null, orders: 1, amount: inr('308000') },
      ],
      tax: { by: 'rate', total: inr('2214000'), rows: [{ key: '500', orders: 30, amount: inr('612000') }, { key: '1200', orders: 18, amount: inr('1488000') }, { key: null, orders: 9, amount: inr('114000') }] },
      offers: [
        { name: 'DIWALI20', orders: 11, discount: inr('892000'), amount: inr('3568000') },
        { name: 'Free shipping over ₹2,000', orders: 17, discount: inr('170000'), amount: inr('4410000') },
      ],
    }
  : null

const suppliers: ReportSuppliers = harness
  ? [
      { supplierId: null, name: null, units: 61 },
      { supplierId: 's1', name: 'Northwind Textiles', units: 23 },
    ]
  : []

const empty: StoreReport | null = india && { ...india, currency: null, currencies: [], takings: null, sold: [], markets: [], tax: null, offers: [] }

const us: StoreReport | null = harness
  ? {
      days: 30,
      timeZone: 'America/New_York',
      currency: 'USD',
      currencies: ['USD'],
      country: 'US',
      takings: { orders: 18, sales: usd('412500'), refunds: usd('0'), net: usd('412500'), previousNet: usd('0'), previousOrders: 0 },
      sold: [{ productId: 'p1', name: 'Canvas Tote', units: 22, amount: usd('264000') }],
      markets: [{ marketId: 'm1', name: 'United States', orders: 18, amount: usd('412500') }],
      tax: { by: 'state', total: usd('31200'), rows: [{ key: 'NY', orders: 9, amount: usd('17800') }, { key: 'OH', orders: 6, amount: usd('10400') }, { key: null, orders: 3, amount: usd('3000') }] },
      offers: [],
    }
  : null

export interface ReportSample {
  report: StoreReport
  suppliers: ReportSuppliers | 'locked'
}

/** The sample for a state, or null for one drawn without data (loading, error, the locked views, denied). */
export const reportSample = (state: ReportState | null): ReportSample | null => {
  if (!harness || !india || !empty || !us || !state) return null
  switch (state) {
    case 'thin':
      return { report: { ...india, takings: india.takings && { ...india.takings, orders: 2 }, sold: india.sold.slice(0, 2) }, suppliers: [] }
    case 'empty':
      return { report: empty, suppliers: [] }
    case 'us':
      return { report: us, suppliers: [] }
    case 'exportLocked':
      return { report: india, suppliers: 'locked' }
    case 'report':
    case 'readOnly':
      return { report: india, suppliers }
    default:
      return null
  }
}
