import type { Customer, CustomerGroup, CustomerSummary } from '../../api/customers'

// Customers' states under ?state= (ui/README.md §6): loading, error, empty, list, noMatch, groups, noGroups, readOnly,
// denied.
export const customerStates = ['loading', 'error', 'empty', 'list', 'noMatch', 'groups', 'noGroups', 'readOnly', 'denied'] as const
export type CustomerState = (typeof customerStates)[number]

// A build-time constant Vite folds, so a production bundle carries none of these literals.
const harness = import.meta.env.DEV || import.meta.env.VITE_STATE_HARNESS === '1'

const inr = (amount: string) => [{ amount, currency: 'INR' }]

const rows: CustomerSummary[] = harness
  ? [
      { id: 'c1', name: 'Ananya Rao', email: 'ananya.rao@example.in', phone: '+91 98450 12345', city: 'Bengaluru', tags: ['Repeat'], orders: 3, spent: inr('1229100') },
      { id: 'c2', name: 'Rohan Mehta', email: 'rohan@example.in', phone: null, city: 'Pune', tags: [], orders: 1, spent: inr('249900') },
      { id: 'c3', name: 'Sara Khan', email: 'sara.khan@example.in', phone: '+91 99000 11223', city: 'Delhi', tags: ['Wholesale'], orders: 2, spent: inr('612000') },
      { id: 'c4', name: 'Vikram Shah', email: 'vikram@example.in', phone: null, city: null, tags: [], orders: 0, spent: [] },
    ]
  : []

const groups: CustomerGroup[] = harness
  ? [
      { id: 'g1', name: 'VIP', description: null, members: 2 },
      { id: 'g2', name: 'Wholesale', description: 'Trade prices', members: 1 },
    ]
  : []

const ananya: Customer | null = harness
  ? {
      id: 'c1',
      name: 'Ananya Rao',
      email: 'ananya.rao@example.in',
      phone: '+91 98450 12345',
      phoneVerified: false,
      tags: ['Repeat'],
      note: 'Prefers gift wrap',
      consent: { state: 'opted_in', at: '2026-09-27T04:42:00.000Z', source: 'checkout', channels: ['email'] },
      groupIds: ['g1'],
      addresses: [{ id: 'a1', name: 'Ananya Rao', line1: '14, 3rd Cross, Indiranagar', line2: null, city: 'Bengaluru', region: 'Karnataka', postalCode: '560038', country: 'IN', phone: null, isDefault: true }],
      city: 'Bengaluru',
      ordersCount: 3,
      orders: [
        { id: 'o1042', number: 'KT-1042', placedAt: '2026-10-10T07:30:00.000Z', state: 'placed', paymentState: 'paid', fulfilmentState: 'unfulfilled', total: { amount: '579600', currency: 'INR' } },
        { id: 'o1031', number: 'KT-1031', placedAt: '2026-09-27T04:42:00.000Z', state: 'placed', paymentState: 'paid', fulfilmentState: 'fulfilled', total: { amount: '649500', currency: 'INR' } },
      ],
      spent: inr('1229100'),
    }
  : null

/** The harness's customer for a row: Ananya in full, anyone else as their row says. */
export const sampleCustomer = (row: CustomerSummary, full: Customer | null): Customer =>
  full && full.id === row.id
    ? full
    : { id: row.id, name: row.name, email: row.email, phone: row.phone, phoneVerified: false, tags: row.tags, note: null, consent: { state: 'not_asked', at: null, source: 'added_by_hand', channels: [] }, groupIds: [], addresses: [], city: row.city, ordersCount: row.orders, orders: [], spent: row.spent }

export interface CustomerSample {
  rows: CustomerSummary[]
  count: number
  groups: CustomerGroup[]
  customer: Customer | null
}

export const customerSample = (state: CustomerState | null): CustomerSample | null => {
  if (!harness || !state || state === 'loading' || state === 'error' || state === 'denied') return null
  switch (state) {
    case 'empty':
      return { rows: [], count: 0, groups: [], customer: null }
    case 'noMatch':
      return { rows: [], count: rows.length, groups, customer: null }
    case 'noGroups':
      return { rows, count: rows.length, groups: [], customer: ananya && { ...ananya, groupIds: [] } }
    default:
      return { rows, count: rows.length, groups, customer: ananya }
  }
}
