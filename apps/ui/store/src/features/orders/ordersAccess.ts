import type { Acting } from '../../api/shell'
import { ordersAccessOf, type OrdersAccess } from './orderView'

// The harness's seats for the Orders screens alone (ui/README.md §6); the shell's ?as= still sets the menu.

const ownerPermissions = ['orders.read', 'orders.write', 'orders.fulfil', 'orders.refund', 'orders.mark_paid', 'exports', 'customers.read']
const staffPermissions = ['orders.read', 'orders.write', 'orders.fulfil', 'exports', 'customers.read']
const supplierPermissions = ['orders.read', 'orders.fulfil', 'orders.refund', 'exports.orders']

export interface OrdersSeat {
  canRead: boolean
  access: OrdersAccess
}

const seat = (role: string, permissions: string[], supplier: boolean, readOnly: boolean): OrdersSeat => ({
  canRead: permissions.includes('orders.read'),
  access: ordersAccessOf({ role, permissions, seller: supplier ? {} : null }, readOnly),
})

export const ordersSeatOf = (forced: string | null, acting: Acting, readOnly: boolean): OrdersSeat => {
  if (forced === 'denied') return seat('supplier-member', ['catalog.read'], true, false)
  if (forced === 'readOnly') return seat('owner', ownerPermissions, false, true)
  if (forced === 'staff') return seat('staff', staffPermissions, false, false)
  if (forced === 'supplier' || forced === 'supplierEmpty' || forced === 'supplierToShopper') return seat('supplier-member', supplierPermissions, true, false)
  if (forced) return seat('owner', ownerPermissions, false, false)
  return { canRead: acting.permissions.includes('orders.read'), access: ordersAccessOf(acting, readOnly) }
}
