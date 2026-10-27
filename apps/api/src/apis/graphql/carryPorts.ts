import { markPaidIn } from '#engine/modules/checkout/index'
import { createFulfilmentService } from '#engine/modules/orders/index'
import type { CarryPorts } from '#engine/modules/ownDelivery/index'

// Carrying a delivery marks cash on delivery paid and ships its lines through checkout and orders; ownDelivery imports
// neither, since both import it (docs/api/README.md §4).
export const carryPorts: CarryPorts = {
  markPaid: (tx, who, orderId) => markPaidIn(tx, { storeId: who.storeId, actor: { ...who.actor, partnerId: who.partnerId }, activity: who.activity, facts: who.facts, now: who.now }, orderId),
  shipLocal: (tx, who, orderId, warehouseId) =>
    createFulfilmentService({ sql: who.sql, context: who.context, actor: { id: who.riderId, partnerId: who.partnerId, kind: 'rider' }, activity: who.activity, facts: who.facts, now: who.now }).shipLocal(tx, orderId, warehouseId),
}
