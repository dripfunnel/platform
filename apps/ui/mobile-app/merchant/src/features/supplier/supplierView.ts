import type { Sale, SupplierLine, SupplierOrder, SupplierOrderRow, SupplierPart } from '../../api/supplier'
import { t } from '../../messages'
import type { Tone } from '../products/productView'

// How the supplier's screens word what the API sent: a part's status, what is left to send, where it goes. The API decides every figure and every
// action again; these only say them and decide which controls to offer.

export type PartStatus = 'toShip' | 'partly' | 'shipped' | 'cancelled'

export const partStatusTone: Record<PartStatus, Tone> = { toShip: 'warning', partly: 'warning', shipped: 'success', cancelled: 'neutral' }

/** A part's state as the chips filter it: partly_shipped, sent_to_store, shipped or delivered, otherwise still to ship. */
export const partStatus = (state: string | null | undefined, orderState: string): PartStatus =>
  orderState === 'cancelled' || state === 'cancelled' ? 'cancelled' : state === 'partly_shipped' ? 'partly' : state === 'sent_to_store' || state === 'shipped' || state === 'delivered' ? 'shipped' : 'toShip'

export const rowStatus = (row: Pick<SupplierOrderRow, 'state' | 'partState'>): PartStatus => partStatus(row.partState, row.state)

/** What the supplier can send of a line: all of it to the shopper, or to the store until it has handed it over. */
export const leftToSend = (line: SupplierLine, part: SupplierPart): number => (part.shippingMode === 'to-store' ? line.quantity - line.sentToStoreQuantity : line.quantity - line.fulfilledQuantity)

export const toStore = (order: SupplierOrder): boolean => order.parts.some((part) => part.shippingMode === 'to-store')

/** A cancelled order or part never ships, and a part with nothing left has nothing to send. */
export const canSendNow = (order: SupplierOrder): boolean => order.state === 'placed' && order.parts.some((part) => part.state !== 'cancelled' && part.lines.some((line) => leftToSend(line, part) > 0))

/** Every line picked in full, as the prototype opens the form. */
export const allLeft = (order: SupplierOrder): Record<string, number> =>
  Object.fromEntries(order.parts.flatMap((part) => part.lines.map((line) => [line.id, leftToSend(line, part)] as const).filter(([, left]) => left > 0)))

/** Where the row's items go, by the mode the order was placed under: a to-store part says nothing of the shopper (ACCESS.md §7.3). */
export const whereText = (row: Pick<SupplierOrderRow, 'shippingMode' | 'city'>): string => (row.shippingMode === 'to-shopper' ? (row.city || t('supplier.toShip.toShopper')) : t('supplier.toShip.toStore'))

export type SaleStatus = 'sold' | 'partlyRefunded' | 'refunded' | 'cancelled'

export const saleTone: Record<SaleStatus, Tone> = { sold: 'success', partlyRefunded: 'warning', refunded: 'neutral', cancelled: 'neutral' }

/** `mySales` answers the order's state and the units refunded, not the part's shipping, so a line says sold, refunded or cancelled (FIRST-RELEASE (store) §17). */
export const saleStatus = (sale: Pick<Sale, 'orderState' | 'quantity' | 'refundedQuantity'>): SaleStatus =>
  sale.orderState === 'cancelled' ? 'cancelled' : sale.refundedQuantity >= sale.quantity ? 'refunded' : sale.refundedQuantity > 0 ? 'partlyRefunded' : 'sold'
