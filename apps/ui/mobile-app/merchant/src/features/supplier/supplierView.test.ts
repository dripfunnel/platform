import { supplierAccessOf } from './access'
import { allLeft, canSendNow, leftToSend, partStatus, saleStatus } from './supplierView'
import { tiers } from './testKit'

const line = (id: string, quantity: number, over: Record<string, unknown> = {}) => ({ id, name: id, versionName: null, quantity, fulfilledQuantity: 0, sentToStoreQuantity: 0, ...over })
const order = (mode: string, lines: ReturnType<typeof line>[], over: Record<string, unknown> = {}) => ({
  id: 'o-1',
  number: 'KT-1',
  state: 'placed',
  placedAt: '2026-10-10T09:30:00Z',
  customerName: null,
  shippingAddress: null,
  parts: [{ id: 'p-1', shippingMode: mode, state: 'to_ship', lines }],
  shipments: [],
  ...over,
})

describe('what a supplier’s seat may do, by tier (ACCESS.md §5.2)', () => {
  const access = (permissions: string[], readOnly = false) => supplierAccessOf({ permissions, supplier: true }, readOnly)

  it('gives To ship to the two orders tiers, and shipping only to the one that fulfils', () => {
    expect(access(tiers.stock)).toMatchObject({ canRead: false, canShip: false, canSeeSales: false, canExport: false })
    expect(access(tiers.catalogue)).toMatchObject({ canRead: false, canShip: false, canSeeSales: false })
    expect(access(tiers.ordersRead)).toMatchObject({ canRead: true, canShip: false, canSeeSales: true, canExport: true })
    expect(access(tiers.ordersFulfil)).toMatchObject({ canRead: true, canShip: true, canSeeSales: true, canExport: true })
  })

  it('gives Your team to a Supplier admin alone', () => {
    expect(access(tiers.ordersFulfil).canOpenTeam).toBe(false)
    expect(access([...tiers.ordersFulfil, 'supplier.team'])).toMatchObject({ canOpenTeam: true, canChangeTeam: true })
  })

  it('stops the writes while the store is read-only, and keeps the reads', () => {
    expect(access([...tiers.ordersFulfil, 'supplier.team'], true)).toMatchObject({ canRead: true, canSeeSales: true, canOpenTeam: true, canShip: false, canChangeTeam: false })
  })

  it('gives a merchant seat nothing of a supplier’s, whatever it holds', () => {
    expect(supplierAccessOf({ permissions: [...tiers.ordersFulfil, 'supplier.team'], supplier: false }, false)).toMatchObject({ canRead: false, canShip: false, canSeeSales: false, canOpenTeam: false })
  })
})

describe('a supplier’s part of an order', () => {
  it('has the status of its part, or cancelled with the order', () => {
    expect(partStatus('to_ship', 'placed')).toBe('toShip')
    expect(partStatus(null, 'placed')).toBe('toShip')
    expect(partStatus('partly_shipped', 'placed')).toBe('partly')
    for (const state of ['sent_to_store', 'shipped', 'delivered']) expect(partStatus(state, 'placed')).toBe('shipped')
    expect(partStatus('to_ship', 'cancelled')).toBe('cancelled')
    expect(partStatus('cancelled', 'placed')).toBe('cancelled')
  })

  it('has what is left to send by its mode: to the store until handed over, to the shopper until shipped', () => {
    const l = line('l1', 3, { sentToStoreQuantity: 1, fulfilledQuantity: 2 })
    const store = order('to-store', [l])
    const shopper = order('to-shopper', [l])
    expect(leftToSend(l, { id: 'p', shippingMode: 'to-store', state: 'to_ship', lines: [l] })).toBe(2)
    expect(leftToSend(l, { id: 'p', shippingMode: 'to-shopper', state: 'to_ship', lines: [l] })).toBe(1)
    expect(allLeft(shopper)).toEqual({ l1: 1 })
    expect(allLeft(store)).toEqual({ l1: 2 })
  })

  it('can be sent only while placed and something is left', () => {
    expect(canSendNow(order('to-store', [line('l1', 1)]))).toBe(true)
    expect(canSendNow(order('to-store', [line('l1', 1, { sentToStoreQuantity: 1 })]))).toBe(false)
    expect(canSendNow(order('to-shopper', [line('l1', 1)], { state: 'cancelled' }))).toBe(false)
  })
})

describe('a sold line', () => {
  it('is sold, partly or fully refunded, or cancelled with its order', () => {
    expect(saleStatus({ orderState: 'placed', quantity: 2, refundedQuantity: 0 })).toBe('sold')
    expect(saleStatus({ orderState: 'placed', quantity: 2, refundedQuantity: 1 })).toBe('partlyRefunded')
    expect(saleStatus({ orderState: 'placed', quantity: 2, refundedQuantity: 2 })).toBe('refunded')
    expect(saleStatus({ orderState: 'cancelled', quantity: 2, refundedQuantity: 2 })).toBe('cancelled')
  })
})
