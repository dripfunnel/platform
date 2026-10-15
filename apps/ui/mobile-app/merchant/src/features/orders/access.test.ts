import { ordersAccessOf } from './access'

// The permissions each seat holds (apps/api src/auth/storePermissions.ts, ACCESS.md §5.1).
const staff = ['orders.read', 'orders.write', 'orders.fulfil', 'exports', 'customers.read']
const manager = [...staff, 'orders.refund', 'orders.mark_paid']
const owner = [...manager, 'shipping.configure']

describe('what a seat may do with orders', () => {
  it('lets Owner and Manager mark paid and refund, and Staff neither', () => {
    expect(ordersAccessOf({ permissions: owner, supplier: false }, false)).toMatchObject({ canMarkPaid: true, canRefund: true })
    expect(ordersAccessOf({ permissions: manager, supplier: false }, false)).toMatchObject({ canMarkPaid: true, canRefund: true })
    expect(ordersAccessOf({ permissions: staff, supplier: false }, false)).toMatchObject({ canMarkPaid: false, canRefund: false })
  })

  it('lets every merchant seat read, ship, cancel and export, and only the Owner book a label (it reads the couriers)', () => {
    for (const permissions of [owner, manager, staff]) expect(ordersAccessOf({ permissions, supplier: false }, false)).toMatchObject({ canRead: true, canShip: true, canCancel: true, canExport: true })
    expect(ordersAccessOf({ permissions: owner, supplier: false }, false).canBook).toBe(true)
    expect(ordersAccessOf({ permissions: manager, supplier: false }, false).canBook).toBe(false)
  })

  it('offers no write while the store is read-only, but still reads and exports', () => {
    expect(ordersAccessOf({ permissions: owner, supplier: false }, true)).toMatchObject({ canRead: true, canExport: true, canShip: false, canBook: false, canMarkPaid: false, canCancel: false, canRefund: false, readOnly: true })
  })

  it('reads nothing for a supplier’s seat, whose To ship is MA 13', () => {
    expect(ordersAccessOf({ permissions: ['orders.read', 'orders.fulfil', 'orders.refund', 'exports.orders'], supplier: true }, false).canRead).toBe(false)
  })

  it('reads nothing without orders.read', () => {
    expect(ordersAccessOf({ permissions: ['catalog.read'], supplier: false }, false).canRead).toBe(false)
  })
})
