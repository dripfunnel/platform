import type postgres from 'postgres'
import type { TenantContext } from '#core/tenancy'
import { riderSummary, selectOrderDeliveries, type DeliveryRow } from '#db/scoped/dispatch'
import { selectHandoverCode } from '#db/scoped/carry'
import { withScope, withSystemScope } from '#db/scoped/index'
import { maxCodeAttempts } from './handoverCode'

export type DeliveryRiderView = NonNullable<Awaited<ReturnType<typeof riderSummary>>>
export interface DeliveryStepView { deliveryId: string; state: string; at: Date }
export interface OrderDeliveryView {
  id: string; state: string; rider: DeliveryRiderView | null; steps: DeliveryStepView[]
  failedReason: string | null; failedNote: string | null; cashCollectedAt: Date | null; codeUnconfirmedAt: Date | null; codeLocked: boolean
}

const stepsOf = (attempts: DeliveryRow[]): DeliveryStepView[] =>
  attempts
    .flatMap((a) => {
      const times = [['created', a.created_at], ['ready', a.ready_at], ['searching', a.searching_at], ['unassigned', a.unassigned_at], ['assigned', a.assigned_at],
        ['picked_up', a.picked_up_at], ['delivered', a.delivered_at], ['failed', a.failed_at], ['cancelled', a.cancelled_at]] as const
      return times.flatMap(([state, at]) => (at ? [{ deliveryId: a.id, state, at }] : []))
    })
    .sort((a, b) => a.at.getTime() - b.at.getTime())

/** A person with orders.read sees the rider's phone; support, API keys and apps never do (DELIVERY §8). Suppliers get no delivery. */
export const readOrderDelivery = async (sql: postgres.Sql, context: TenantContext, orderId: string): Promise<OrderDeliveryView | null> => {
  if (context.sellerScope.kind === 'seller') return null
  const view = await withScope(sql, context, async (tx) => {
    const attempts = await selectOrderDeliveries(tx, context.storeId, orderId)
    const latest = attempts[0]
    if (!latest) return null
    const rider = latest.rider_id ? await riderSummary(tx, context.storeId, latest.rider_id) : null
    const showsPhone = context.caller.kind === 'person' || context.caller.kind === 'impersonation'
    return { latest, view: { id: latest.id, state: latest.state, rider: rider && !showsPhone ? { ...rider, phone: null } : rider, steps: stepsOf(attempts),
      failedReason: latest.failed_reason, failedNote: latest.failed_note, cashCollectedAt: latest.cash_collected_at, codeUnconfirmedAt: latest.code_unconfirmed_at } }
  })
  if (!view) return null
  // Whether the code is locked, never the code or its count: no request role reads those (migration 0364).
  const held = view.latest.state === 'picked_up' ? await withSystemScope(sql, (tx) => selectHandoverCode(tx, view.latest)) : null
  return { ...view.view, codeLocked: (held?.code_attempts ?? 0) >= maxCodeAttempts }
}
