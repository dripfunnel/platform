import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import { isUuid } from '#core/ids'
import { PaymentRefused, PaymentUnavailable, isCardProvider, type PaymentGateways } from '#core/payments'
import { pageOf, type Page, type PageWindow } from '#core/paging'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import { selectAccountById } from '#db/scoped/payments'
import {
  addRefunded,
  defaultWarehousesOf,
  insertLedgerEntry,
  insertPaymentRefund,
  insertRefund,
  insertReturn,
  lockLinesToRefund,
  lockOrderToRefund,
  lockReturn,
  markPaymentRefunded,
  restockReturned,
  returnFullyRefunded,
  selectCapturedPayment,
  selectLedger,
  selectLedgerBalance,
  setReturnState,
  unreturn,
  type LedgerRow,
  type LineToRefundRow,
} from '#db/scoped/refunds'
import { openAccount } from '#engine/modules/checkout/index'

export type { LedgerRow, RefundRow, ReturnRow } from '#db/scoped/refunds'

// Returns and refunds (PLATFORM-PROMPT §5.4; ACCESS §7.3; PortalOrders): the store starts and receives returns; each owner
// refunds its own lines and the store may refund a supplier's itself, an override the supplier ledger records. Money goes
// back through the payment it came in on: the card provider's, or the store's own hand for cash and transfers.

export const returnReasons = ['doesnt_fit', 'changed_mind', 'damaged', 'wrong_item', 'not_as_described'] as const
export type ReturnReason = (typeof returnReasons)[number]
export const refundReasons = ['returned', 'goodwill', 'other'] as const
export type RefundReason = (typeof refundReasons)[number]

export const refundAudit = {
  returnStarted: 'return.started',
  returnReceived: 'return.received',
  returnCancelled: 'return.cancelled',
  issued: 'refund.issued',
  overridden: 'refund.overridden',
} as const

export type RefundRefusal =
  | 'INVALID_INPUT'
  | 'NOT_FOUND'
  | 'NOT_YOURS'
  | 'TOO_MANY'
  | 'NOT_PAID'
  | 'NOT_RECEIVED'
  | 'NOT_REQUESTED'
  | 'NO_LOCATION'
  | 'PROVIDER_UNAVAILABLE'
  | 'PROVIDER_REFUSED'
  | 'READ_ONLY'
export type RefundResult<T> = { ok: true; value: T } | { ok: false; reason: RefundRefusal }

export interface RefundInput {
  orderId: string
  returnId: string | null
  /** A line and how many of its shipped units go back, with the amount if not the line's own share; 0 units is money only. */
  lines: readonly { lineId: string; quantity: number; amount: string | null }[]
  /** The store's alone (ACCESS §7.3): shipping or goodwill beyond the lines. */
  extra: string | null
  reason: RefundReason
  note: string | null
  restock: boolean
  /** The store refunding a supplier's lines itself. */
  override: boolean
}

export interface RefundDeps {
  sql: postgres.Sql
  context: TenantContext
  actor: { id: string; partnerId: string }
  activity: ActivityLog
  facts: RequestFacts
  gateways: PaymentGateways
  secrets: SecretBox | null
  now: () => Date
}

class Refused extends Error {
  constructor(readonly reason: RefundRefusal) {
    super(reason)
  }
}

const maxLines = 100
const minor = (value: string | null): bigint | null | undefined => {
  if (value === null) return null
  return /^\d{1,15}$/.test(value) ? BigInt(value) : undefined
}
const noteOf = (note: string | null): string | null | undefined => {
  const text = note?.trim() ?? ''
  return text.length === 0 ? null : text.length > 1000 ? undefined : text
}

/** The same refund asked for twice from the same order state is one refund at the provider: its id comes from that state. */
const refundIdOf = async (orderId: string, refundedBefore: string, part: string | null, amount: bigint): Promise<string> => {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${orderId}:${refundedBefore}:${part ?? 'store'}:${amount}`)))
  const hex = [...digest.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80).toString(16)}${hex.slice(18, 20)}-${hex.slice(20, 32)}`
}

/** What a line's units are worth of what the shopper paid for it: the rest of it when they are the last ones. */
const shareOf = (line: LineToRefundRow, quantity: number): bigint => {
  const total = BigInt(line.line_total_amount)
  const left = total - BigInt(line.refunded_amount)
  if (quantity === line.quantity - line.refunded_quantity) return left
  const share = (total * BigInt(quantity)) / BigInt(line.quantity)
  return share < left ? share : left
}

/** Money only, on a line: up to what its shipped units are worth less what has gone back; unshipped ones go back by cancelling. */
const shippedWorthLeft = (line: LineToRefundRow): bigint => {
  const total = BigInt(line.line_total_amount)
  const shipped = line.fulfilled_quantity >= line.quantity ? total : (total * BigInt(line.fulfilled_quantity)) / BigInt(line.quantity)
  const left = shipped - BigInt(line.refunded_amount)
  return left > 0n ? left : 0n
}

export const createRefundService = ({ sql, context, actor, activity, facts, gateways, secrets, now }: RefundDeps) => {
  const { storeId } = context
  const sellerId = context.sellerScope.kind === 'seller' ? context.sellerScope.sellerId : null
  const readOnly = context.caller.kind === 'support' && context.caller.access === 'read'

  const entry = (action: string, order: { id: string; number: string }, reason: string | null): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target: { type: 'order', id: order.id, label: order.number },
    reason,
    api: 'store',
    visibility: 'store',
    ...facts,
  })
  // The store's full entry, and a thin one for each supplier whose lines it touches: no free text, no shopper (LOGGING §3).
  const record = (tx: ScopedSql, action: string, order: { id: string; number: string }, reason: string | null, suppliers: Iterable<string | null>) => {
    const owners = [...new Set(suppliers)].filter((s): s is string => s !== null)
    return activity.recordAll(tx, [entry(action, order, reason), ...owners.map((s) => ({ ...entry(action, order, null), sellerId: s }))])
  }
  const run = async <T>(work: (tx: ScopedSql) => Promise<RefundResult<T>>): Promise<RefundResult<T>> => {
    if (readOnly) return { ok: false, reason: 'READ_ONLY' }
    try {
      return await withSystemScope(sql, work)
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  // The store's (orders.refund): lines that have shipped, back to their owner's location by the part's mode (ACCESS §7.3).
  const startReturn = async (input: { orderId: string; lines: readonly { lineId: string; quantity: number }[]; reason: string; note: string | null }): Promise<RefundResult<string>> => {
    const note = noteOf(input.note)
    const ids = input.lines.map((l) => l.lineId.toLowerCase())
    if (
      sellerId || !isUuid(input.orderId) || input.lines.length === 0 || input.lines.length > maxLines || !ids.every(isUuid) || new Set(ids).size !== ids.length
      || input.lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 1) || !(returnReasons as readonly string[]).includes(input.reason) || note === undefined
    ) {
      return { ok: false, reason: sellerId ? 'NOT_FOUND' : 'INVALID_INPUT' }
    }
    return run(async (tx) => {
      const order = await lockOrderToRefund(tx, storeId, input.orderId)
      if (!order) return { ok: false, reason: 'NOT_FOUND' }
      const byId = new Map((await lockLinesToRefund(tx, order.id)).map((l) => [l.id, l]))
      const picked: { line: LineToRefundRow; quantity: number; backTo: string | null }[] = []
      for (const [i, id] of ids.entries()) {
        const line = byId.get(id)
        const quantity = input.lines[i]?.quantity ?? 0
        if (!line) return { ok: false, reason: 'NOT_FOUND' }
        // Shipped units not in a return yet nor refunded outside one: a unit goes back one way only.
        if (quantity > line.fulfilled_quantity - line.returned_quantity - line.refunded_outside) return { ok: false, reason: 'TOO_MANY' }
        picked.push({ line, quantity, backTo: line.shipping_mode === 'to-shopper' ? line.seller_id : null })
      }
      const homes = await defaultWarehousesOf(tx, storeId, picked.map((p) => p.backTo))
      const lines: { lineId: string; sellerId: string | null; quantity: number; destination: string }[] = []
      for (const p of picked) {
        const destination = homes.get(p.backTo)
        if (!destination) return { ok: false, reason: 'NO_LOCATION' }
        lines.push({ lineId: p.line.id, sellerId: p.line.seller_id, quantity: p.quantity, destination })
      }
      const made = await insertReturn(tx, { storeId, orderId: order.id, orderNumber: order.number, reason: input.reason, note, createdBy: actor.id }, lines)
      await record(tx, refundAudit.returnStarted, order, input.reason, lines.map((l) => l.sellerId))
      return { ok: true, value: made.id }
    })
  }

  // Marking it received is the store's; cancelling it, only while it's still on its way back (#183).
  const moveReturn = (returnId: string, to: 'received' | 'cancelled'): Promise<RefundResult<true>> => {
    if (sellerId || !isUuid(returnId)) return Promise.resolve({ ok: false, reason: 'NOT_FOUND' })
    return run(async (tx) => {
      const found = await lockReturn(tx, storeId, returnId)
      if (!found) return { ok: false, reason: 'NOT_FOUND' }
      if (found.state !== 'requested') return { ok: false, reason: 'NOT_REQUESTED' }
      await setReturnState(tx, found.id, to, now())
      if (to === 'cancelled') await unreturn(tx, found.lines)
      await record(tx, to === 'received' ? refundAudit.returnReceived : refundAudit.returnCancelled, { id: found.order_id, number: found.order_number }, found.number, found.lines.map((l) => l.seller_id))
      return { ok: true, value: true }
    })
  }

  const refund = async (input: RefundInput): Promise<RefundResult<string[]>> => {
    const note = noteOf(input.note)
    const extra = minor(input.extra)
    const ids = input.lines.map((l) => l.lineId.toLowerCase())
    const amounts = input.lines.map((l) => minor(l.amount))
    if (
      !isUuid(input.orderId) || (input.returnId !== null && !isUuid(input.returnId)) || input.lines.length > maxLines || !ids.every(isUuid) || new Set(ids).size !== ids.length
      || input.lines.some((l) => !Number.isInteger(l.quantity) || l.quantity < 0) || amounts.some((a) => a === undefined) || extra === undefined || note === undefined
      || !(refundReasons as readonly string[]).includes(input.reason) || (input.lines.length === 0 && !extra)
      || (sellerId !== null && (extra !== null || input.override))
    ) {
      return { ok: false, reason: 'INVALID_INPUT' }
    }
    return run(async (tx) => {
      const order = await lockOrderToRefund(tx, storeId, input.orderId)
      const all = order ? await lockLinesToRefund(tx, order.id) : []
      // A supplier hears of an order only through its own lines (ACCESS §7.3).
      if (!order || (sellerId && !all.some((l) => l.seller_id === sellerId))) return { ok: false, reason: 'NOT_FOUND' }
      if (order.state !== 'placed' || (order.payment_state !== 'paid' && order.payment_state !== 'partly_refunded')) return { ok: false, reason: 'NOT_PAID' }
      const inReturn = input.returnId ? await lockReturn(tx, storeId, input.returnId) : null
      // A supplier hears of a return only when it holds its own lines, as it hears of an order (ACCESS §7.3).
      if (input.returnId && (!inReturn || inReturn.order_id !== order.id || (sellerId && !inReturn.lines.some((l) => l.seller_id === sellerId)))) return { ok: false, reason: 'NOT_FOUND' }
      if (inReturn && inReturn.state !== 'received') return { ok: false, reason: 'NOT_RECEIVED' }

      // A supplier looks lines up among its own only, so another owner's line is as unknown as one that doesn't exist.
      const byId = new Map(all.filter((l) => !sellerId || l.seller_id === sellerId).map((l) => [l.id, l]))
      const owners = new Map<string | null, { lineId: string; quantity: number; amount: bigint; line: LineToRefundRow }[]>()
      for (const [i, id] of ids.entries()) {
        const line = byId.get(id)
        const quantity = input.lines[i]?.quantity ?? 0
        if (!line) return { ok: false, reason: 'NOT_FOUND' }
        // Each owner refunds its own; the store a supplier's only as an override.
        if (!sellerId && line.seller_id !== null && !input.override) return { ok: false, reason: 'NOT_YOURS' }
        // Shipped units only (unshipped ones go back by cancelling): in a return, what it holds that its refunds haven't taken;
        // outside one, what no return holds and no refund has taken.
        const inThis = inReturn?.lines.find((l) => l.order_line_id === line.id)
        const free = inReturn ? (inThis ? inThis.quantity - inThis.refunded : 0) : line.fulfilled_quantity - line.returned_quantity - line.refunded_outside
        if (quantity > free) return { ok: false, reason: 'TOO_MANY' }
        const share = quantity > 0 ? shareOf(line, quantity) : shippedWorthLeft(line)
        const amount = amounts[i] ?? (quantity > 0 ? share : null)
        if (amount === null || amount === undefined || amount > share || (amount === 0n && quantity === 0)) return { ok: false, reason: amount !== null && amount !== undefined && amount > share ? 'TOO_MANY' : 'INVALID_INPUT' }
        const group = owners.get(line.seller_id) ?? []
        group.push({ lineId: line.id, quantity, amount, line })
        owners.set(line.seller_id, group)
      }
      if (extra) owners.set(null, owners.get(null) ?? [])
      const total = [...owners.entries()].reduce((sum, [owner, lines]) => sum + lines.reduce((s, l) => s + l.amount, 0n) + (owner === null ? (extra ?? 0n) : 0n), 0n)
      if (total <= 0n || total > BigInt(order.total_amount) - BigInt(order.refunded_amount)) return { ok: false, reason: 'TOO_MANY' }

      const payment = await selectCapturedPayment(tx, order.id)
      if (!payment) return { ok: false, reason: 'NOT_PAID' }
      const gateway = isCardProvider(payment.provider) ? gateways[payment.provider] : null
      const accountRow = gateway && payment.provider_account_id ? await selectAccountById(tx, payment.provider_account_id) : null
      const account = accountRow ? await openAccount(accountRow, payment.mode, secrets) : null
      if (isCardProvider(payment.provider) && (!gateway || !account || !payment.provider_ref)) return { ok: false, reason: 'PROVIDER_UNAVAILABLE' }

      const made: { id: string; amount: bigint }[] = []
      let refundedBefore = order.refunded_amount
      for (const [owner, lines] of owners) {
        const amount = lines.reduce((s, l) => s + l.amount, 0n) + (owner === null ? (extra ?? 0n) : 0n)
        if (amount <= 0n) continue
        const id = await refundIdOf(order.id, refundedBefore, owner, amount)
        refundedBefore = (BigInt(refundedBefore) + amount).toString()
        const override = owner !== null && sellerId === null
        await insertRefund(
          tx,
          { id, storeId, sellerId: owner, orderId: order.id, returnId: inReturn?.id ?? null, amount, currency: order.currency, reason: input.reason, note, restock: input.restock, override, byUserId: actor.id },
          lines.map((l) => ({ lineId: l.lineId, quantity: l.quantity, amount: l.amount })),
        )
        if (override && owner) await insertLedgerEntry(tx, { storeId, sellerId: owner, amount, currency: order.currency, refundId: id, createdBy: actor.id })
        await record(tx, override ? refundAudit.overridden : refundAudit.issued, order, input.reason, [owner])
        made.push({ id, amount })
      }
      // Back on hand at the owner's own location; a to-store supplier's units go back to it from the store, its to count.
      if (input.restock) {
        const back = [...owners.values()].flat().filter((x) => x.quantity > 0 && x.line.track_stock && x.line.shipping_mode !== 'to-store')
        const homes = await defaultWarehousesOf(tx, storeId, back.map((l) => l.line.seller_id))
        const items = back.map((l) => {
          const warehouseId = inReturn?.lines.find((r) => r.order_line_id === l.lineId)?.destination_warehouse_id ?? homes.get(l.line.seller_id)
          if (!warehouseId) throw new Refused('NO_LOCATION')
          return { sellerId: l.line.seller_id, productId: l.line.product_id, versionId: l.line.version_id, warehouseId, quantity: l.quantity }
        })
        await restockReturned(tx, { storeId, returnId: inReturn?.id ?? null, orderId: order.id, actorId: actor.id }, items)
      }
      // One provider refund for the whole request, asked last inside the transaction: all of it goes back or none of it,
      // and the same request from the same order state is the same refund there.
      let atProvider: { providerRef: string | null; state: 'pending' | 'done' } = { providerRef: null, state: 'done' }
      if (gateway && account && payment.provider_ref) {
        try {
          const back = await gateway.refund(account, payment.provider_ref, { refundId: await refundIdOf(order.id, order.refunded_amount, 'request', total), amount: { amount: total, currency: order.currency } })
          if (back.state === 'failed') throw new Refused('PROVIDER_REFUSED')
          atProvider = { providerRef: back.providerRef, state: back.state }
        } catch (error) {
          if (error instanceof PaymentUnavailable) throw new Refused('PROVIDER_UNAVAILABLE')
          if (error instanceof PaymentRefused) throw new Refused('PROVIDER_REFUSED')
          throw error
        }
      }
      // Cash on delivery or a transfer: the store gives the money back itself, and this records that it did.
      for (const r of made) await insertPaymentRefund(tx, { refundId: r.id, paymentId: payment.id, storeId, providerRef: atProvider.providerRef, state: atProvider.state, amount: r.amount, currency: order.currency })
      await addRefunded(tx, order.id, total, now())
      if (BigInt(order.refunded_amount) + total >= BigInt(order.total_amount)) await markPaymentRefunded(tx, payment.id, now())
      if (inReturn && (await returnFullyRefunded(tx, inReturn.id))) await setReturnState(tx, inReturn.id, 'refunded', now())
      return { ok: true, value: made.map((r) => r.id) }
    })
  }

  /** A supplier's ledger and balance: the merchant side names the supplier, a supplier reads its own whatever it names. */
  const ledger = async (supplierId: string | null, window: PageWindow): Promise<{ page: Page<LedgerRow>; balance: { amount: string; currency: string }[] } | null> => {
    const whose = sellerId ?? supplierId
    if (!whose || !isUuid(whose)) return null
    return withScope(sql, context, async (tx) => ({
      page: pageOf(await selectLedger(tx, storeId, whose, sellerId !== null, window), window, (e) => ({ occurredAt: e.created_at, id: e.id })),
      balance: await selectLedgerBalance(tx, storeId, whose),
    }))
  }

  return { startReturn, receiveReturn: (id: string) => moveReturn(id, 'received'), cancelReturn: (id: string) => moveReturn(id, 'cancelled'), refund, ledger }
}
