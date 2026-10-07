import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { withScope } from '#db/scoped/index'
import { selectFulfilments, type FulfilmentRow } from '#db/scoped/fulfilment'
import {
  countMerchantOrders,
  countSupplierOrders,
  selectMerchantOrder,
  selectMerchantOrders,
  selectOrderHistory,
  selectOrderLabel,
  selectSupplierOrder,
  selectSupplierOrders,
  type OrderCounts,
  type OrderDetailRow,
  type OrderFilter,
  type OrderHistoryRow,
  type OrderListRow,
} from '#db/scoped/storeOrders'

// Orders on the merchant side and a supplier's own part of them (PLATFORM-PROMPT §5.4; ACCESS §7.3; FIRST-RELEASE §6):
// every read runs in the caller's own scope, so what a supplier sees is what its role and the two views let it.

export { orderFilters, type OrderCounts, type OrderDetailRow, type OrderFilter, type OrderHistoryRow, type OrderLineRow, type OrderListRow, type OrderPartRow } from '#db/scoped/storeOrders'

export const ordersAudit = { noteAdded: 'order.note_added' } as const

export type OrdersRefusal = 'INVALID_INPUT' | 'NOT_FOUND' | 'READ_ONLY'
export type OrdersResult<T> = { ok: true; value: T } | { ok: false; reason: OrdersRefusal }

/** A note is a line in the order's history (PortalOrders "Add a note"), never a document. */
export const maxNoteLength = 1000
/** The history the detail shows; older entries are in Activity. */
export const historyLimit = 100

export interface OrdersDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  now: () => Date
}

export const createOrdersService = ({ sql, context, actor, activity, facts }: OrdersDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null

  const list = (filter: OrderFilter, search: string | null, window: PageWindow): Promise<OrderListRow[]> => {
    const term = search?.trim().slice(0, 100) || null
    return withScope(sql, context, (tx) => (sellerId ? selectSupplierOrders(tx, filter, term, window) : selectMerchantOrders(tx, storeId, filter, term, window)))
  }

  const counts = (): Promise<OrderCounts> => withScope(sql, context, (tx) => (sellerId ? countSupplierOrders(tx) : countMerchantOrders(tx, storeId)))

  const detail = async (orderId: string): Promise<(OrderDetailRow & { history: OrderHistoryRow[]; fulfilments: FulfilmentRow[] }) | null> => {
    if (!isUuid(orderId)) return null
    return withScope(sql, context, async (tx) => {
      const order = sellerId ? await selectSupplierOrder(tx, orderId) : await selectMerchantOrder(tx, storeId, orderId)
      // A supplier's shipments are its own: the store's onward one carries no seller, so its tracking stays the store's.
      return order ? { ...order, history: await selectOrderHistory(tx, storeId, orderId, sellerId, historyLimit), fulfilments: await selectFulfilments(tx, orderId) } : null
    })
  }

  // Only the store's team writes notes; the note is the entry's reason, which a supplier's thin entries never carry.
  const addNote = async (orderId: string, note: string): Promise<OrdersResult<true>> => {
    const text = note.trim()
    // The activity log takes a support session's entries, so read-only support is refused here, not by a row policy (ACCESS §8).
    if (context.caller.kind === 'support' && context.caller.access === 'read') return { ok: false, reason: 'READ_ONLY' }
    if (sellerId || !isUuid(orderId) || text.length === 0 || text.length > maxNoteLength) return { ok: false, reason: sellerId ? 'NOT_FOUND' : 'INVALID_INPUT' }
    return withScope(sql, context, async (tx): Promise<OrdersResult<true>> => {
      const number = await selectOrderLabel(tx, storeId, orderId)
      if (!number) return { ok: false, reason: 'NOT_FOUND' }
      await activity.record(tx, {
        category: 'write',
        action: ordersAudit.noteAdded,
        result: 'success',
        actorKind: 'person',
        actorId: actor.id,
        actorLabel: null,
        partnerId: actor.partnerId,
        storeId,
        target: { type: 'order', id: orderId, label: number },
        reason: text,
        api: 'store',
        visibility: 'store',
        ...facts,
      })
      return { ok: true, value: true }
    })
  }

  return { list, counts, detail, addNote }
}
