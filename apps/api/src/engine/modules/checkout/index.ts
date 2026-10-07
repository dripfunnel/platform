import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import { isUuid } from '#core/ids'
import type { Money } from '#core/money'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  cancelOrder,
  insertPayment,
  lockCart,
  lockPlacedOrder,
  recordPaid,
  releaseStock,
  reserveLine,
  selectLivePaymentAccounts,
  selectSnapshotVersions,
  selectPaymentSetup,
  saveManualMethod,
  selectShopOrder,
  selectStoreCountry,
  turnOffMethod,
  selectUnpaidTransfers,
  takeOrderNumber,
  writeSnapshot,
  type PaymentAccountRow,
  type SnapshotLine,
} from '#db/scoped/orders'
import { createCartService, type CartDeps, type CartView, type CheckoutProblem } from '#engine/modules/cart/index'

// Placing an order and paying for it (SAPI 10; PLATFORM-PROMPT §5.4 Payments). The cart is priced as its shopper, then the
// snapshot, number, held stock and payment are written in system scope, as nothing a shopper writes may be a price or state.

export const paymentProviders = ['stripe', 'paypal', 'razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer'] as const
export type PaymentProvider = (typeof paymentProviders)[number]

/** Paid later, so the order is accepted and holds its stock when placed (decided 2026-10-05 on #284). */
const manual = ['cod', 'bank_transfer'] as const

/** Who may take payment where (FIRST-RELEASE §1): India's and the US's providers; no other region at launch. */
export const providersFor = (country: string | null): readonly PaymentProvider[] =>
  country === 'IN' ? ['razorpay', 'cashfree', 'phonepe', 'cod', 'bank_transfer'] : country === 'US' ? ['stripe', 'paypal', 'bank_transfer'] : []

export const transferDaysMs = 3 * 86_400_000

export type { ShopOrderRow } from '#db/scoped/orders'

export const checkoutAudit = { placed: 'order.placed', markedPaid: 'order.marked_paid', cancelled: 'order.cancelled' } as const

export type CheckoutRefusal = 'NOT_READY' | 'METHOD_UNAVAILABLE' | 'ALREADY_PLACED' | 'CART_CHANGED' | 'READ_ONLY' | 'OUT_OF_STOCK' | 'NOT_FOUND' | 'NOT_PENDING'
export type CheckoutResult<T> = { ok: true; value: T } | { ok: false; reason: CheckoutRefusal; problems?: CheckoutProblem[] }

class Refused extends Error {
  constructor(readonly reason: CheckoutRefusal) {
    super(reason)
  }
}

export interface PaymentOption {
  provider: PaymentProvider
  kind: 'card' | 'cod' | 'bank_transfer'
  /** What the shopper needs to pay: a transfer's bank details. */
  instructions: string | null
  mode: 'test' | 'live'
}

export interface PlacedOrder {
  orderId: string
  number: string
  total: Money
  provider: PaymentProvider
  instructions: string | null
}

export interface CheckoutDeps extends Omit<CartDeps, 'allowNewCart'> {
  /** The store's country, for which providers may take payment there. */
  country: string | null
}

const kindOf = (p: PaymentProvider): PaymentOption['kind'] => (p === 'cod' ? 'cod' : p === 'bank_transfer' ? 'bank_transfer' : 'card')

/** Providers a cart can pay with today: manual ways now; the card providers come with their adapters (#309 parts 2–3). */
const isManual = (p: string): p is (typeof manual)[number] => manual.some((m) => m === p)
const placeable = (p: PaymentProvider) => isManual(p)

// In the region's own order, as Payment setup lists them.
const rank = (country: string | null, provider: string) => providersFor(country).findIndex((p) => p === provider)

const optionsOf = (accounts: readonly PaymentAccountRow[], country: string | null): PaymentOption[] =>
  [...accounts].sort((a, b) => rank(country, a.provider) - rank(country, b.provider)).flatMap((a) => {
    const provider = paymentProviders.find((p) => p === a.provider)
    if (!provider || !providersFor(country).includes(provider) || !placeable(provider)) return []
    return [{ provider, kind: kindOf(provider), instructions: provider === 'bank_transfer' ? a.bank_details : null, mode: a.mode }]
  })

/** A courier's own service name; flat delivery and collection have none, as the storefront words them (no literal text here). */
const shippingLabel = (cart: CartView): string | null => {
  const chosen = cart.shippingOptions.find((o) => o.id === cart.shippingOption)
  return chosen?.id === 'courier' && chosen.service ? chosen.service : null
}

export const createCheckout = (deps: CheckoutDeps) => {
  const { sql, context, now, activity, facts } = deps
  const { storeId } = context
  const customerId = context.caller.kind === 'shopper' ? context.caller.customerId : null

  const liveAccounts = () => withScope(sql, context, (tx) => selectLivePaymentAccounts(tx, storeId))
  const options = async (): Promise<PaymentOption[]> => optionsOf(await liveAccounts(), deps.country)

  const placedEntry = (orderId: string, number: string): ActivityEntry => ({
    category: 'write',
    action: checkoutAudit.placed,
    result: 'success',
    actorKind: customerId ? 'customer' : 'anonymous',
    actorId: customerId,
    actorLabel: null,
    partnerId: context.partnerId,
    storeId,
    customerId,
    target: { type: 'order', id: orderId, label: number },
    reason: null,
    api: 'shop',
    visibility: 'store',
    ...facts,
  })

  const snapshotLines = async (tx: ScopedSql, cart: CartView, reserve: boolean): Promise<SnapshotLine[]> => {
    const versions = new Map((await selectSnapshotVersions(tx, storeId, cart.lines.map((l) => l.versionId))).map((v) => [v.id, v]))
    const heldAt = new Map<string, string | null>()
    // Checked again here, holding the rows, so two shoppers can't both buy the last one (PLATFORM-PROMPT §5.4); in
    // version order, so two orders holding the same versions never wait on each other.
    for (const l of reserve ? [...cart.lines].sort((a, b) => a.versionId.localeCompare(b.versionId)) : []) {
      const v = versions.get(l.versionId)
      if (!v?.track_stock) continue
      const held = await reserveLine(tx, storeId, v.id, l.quantity, v.continue_selling)
      if (!held) throw new Refused('OUT_OF_STOCK')
      heldAt.set(v.id, held.warehouseId)
    }
    const lines: SnapshotLine[] = []
    for (const l of cart.lines) {
      const v = versions.get(l.versionId)
      if (!v || !l.item || !l.unitPrice || !l.lineTotal) throw new Refused('NOT_READY')
      const reservedWarehouseId = heldAt.get(v.id) ?? null
      const tax = cart.tax?.lines.find((t) => t.id === l.versionId)
      lines.push({
        versionId: v.id,
        productId: v.product_id,
        sellerId: v.seller_id,
        name: l.item.product.name,
        versionName: l.item.version.name,
        sku: l.item.version.sku,
        hsCode: v.hs_code,
        taxClassId: l.item.taxClassId,
        taxRateBps: tax?.rateBps ?? null,
        quantity: l.quantity,
        unitAmount: l.unitPrice.amount,
        taxAmount: tax?.amount ?? 0n,
        lineTotalAmount: l.lineTotal.amount,
        weightGrams: v.weight_grams,
        reservedWarehouseId,
      })
    }
    return lines
  }

  /**
   * "Pay": the cart priced now and ready, then placed with the provider chosen. A way paid later holds the stock at once
   * and a transfer is due in 3 days; a card provider holds it when its payment arrives (parts 2–3).
   */
  const place = async (provider: string): Promise<CheckoutResult<PlacedOrder>> => {
    const cart = await createCartService({ ...deps, allowNewCart: async () => false }).cart()
    if (!cart) return { ok: false, reason: 'NOT_FOUND' }
    // Sold out since the shopper reached payment: said as such, however the race fell (before the lock or under it).
    if (cart.lines.some((l) => l.problem === 'short' || l.problem === 'unavailable')) return { ok: false, reason: 'OUT_OF_STOCK' }
    if (cart.problems.length > 0 || cart.checkoutStep !== 'pay') return { ok: false, reason: 'NOT_READY', problems: cart.problems }
    // One read: the option and the account the payment names can't drift apart.
    const accounts = await liveAccounts()
    const option = optionsOf(accounts, deps.country).find((o) => o.provider === provider)
    if (!option) return { ok: false, reason: 'METHOD_UNAVAILABLE' }
    const accountId = accounts.find((a) => a.provider === option.provider)?.id ?? null
    try {
      return await withSystemScope(sql, async (tx) => {
        const locked = await lockCart(tx, storeId, cart.id)
        if (!locked) throw new Refused('ALREADY_PLACED')
        // Changed in another tab since it was priced: the shopper sees the new cart before paying for it.
        if (locked.revision !== cart.revision) throw new Refused('CART_CHANGED')
        const paidLater = isManual(option.provider)
        const lines = await snapshotLines(tx, cart, paidLater)
        const parts = [...new Map(lines.map((l) => [l.sellerId ?? 'store', l.sellerId])).values()]
        const modes = new Map((await selectSnapshotVersions(tx, storeId, lines.map((l) => l.versionId))).map((v) => [v.seller_id ?? 'store', v.shipping_mode]))
        const number = await takeOrderNumber(tx, storeId)
        const at = now()
        await writeSnapshot(tx, storeId, {
          orderId: cart.id,
          number,
          lines,
          parts: parts.map((sellerId) => ({ sellerId, shippingMode: sellerId ? (modes.get(sellerId) ?? 'to-store') : 'store' })),
          shipping: cart.shipping ? { amount: cart.shipping.amount, label: shippingLabel(cart) } : null,
          tax: { amount: cart.tax?.amount.amount ?? 0n, inclusive: cart.tax?.inclusive ?? false },
          subtotal: cart.subtotal.amount,
          total: cart.total.amount,
          paymentMethod: option.provider,
          paymentDueBy: option.provider === 'bank_transfer' ? new Date(at.getTime() + transferDaysMs) : null,
          stockReserved: paidLater,
          now: at,
        })
        await insertPayment(tx, { orderId: cart.id, storeId, provider: option.provider, accountId, kind: option.kind, amount: cart.total.amount, currency: cart.currency, mode: option.mode, providerRef: null })
        await activity.record(tx, placedEntry(cart.id, number))
        return { ok: true as const, value: { orderId: cart.id, number, total: cart.total, provider: option.provider, instructions: option.instructions } }
      })
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  /** A shopper's own placed order, for the confirmation and order pages. */
  const order = (orderId: string) => (isUuid(orderId) ? withScope(sql, context, (tx) => selectShopOrder(tx, storeId, orderId.toLowerCase())) : Promise.resolve(null))

  return { options, place, order }
}

/** "Mark as paid" (Owner and Manager, `orders.mark_paid`): a cash-on-delivery or transfer order whose money has arrived. */
export const markPaid = (deps: { sql: postgres.Sql; context: TenantContext; actor: { id: string; partnerId: string }; activity: ActivityLog; facts: RequestFacts; now: () => Date }, orderId: string): Promise<CheckoutResult<true>> =>
  withSystemScope(deps.sql, async (tx): Promise<CheckoutResult<true>> => {
    // System scope passes no row policy, so read-only support is refused here (ACCESS §8).
    if (deps.context.caller.kind === 'support' && deps.context.caller.access === 'read') return { ok: false, reason: 'READ_ONLY' }
    const order = await lockPlacedOrder(tx, deps.context.storeId, orderId)
    if (!order) return { ok: false, reason: 'NOT_FOUND' }
    if (order.state !== 'placed' || order.payment_state !== 'pending' || !(order.payment_method && isManual(order.payment_method))) return { ok: false, reason: 'NOT_PENDING' }
    await recordPaid(tx, deps.context.storeId, orderId, deps.now())
    await deps.activity.record(tx, {
      category: 'write',
      action: checkoutAudit.markedPaid,
      result: 'success',
      actorKind: 'person',
      actorId: deps.actor.id,
      actorLabel: null,
      partnerId: deps.actor.partnerId,
      storeId: deps.context.storeId,
      target: { type: 'order', id: orderId, label: order.number },
      reason: order.payment_method,
      api: 'store',
      visibility: 'store',
      ...deps.facts,
    })
    return { ok: true, value: true }
  })

/** The cron cancels a transfer unpaid after 3 days and releases its stock, as the system (LOGGING §3; #284). */
export const releaseUnpaidTransfers = (sql: postgres.Sql, activity: ActivityLog, now: Date): Promise<number> =>
  withSystemScope(sql, async (tx) => {
    const due = await selectUnpaidTransfers(tx, now, 100)
    for (const order of due) {
      await releaseStock(tx, order.store_id, order.id)
      await cancelOrder(tx, order.store_id, order.id, 'unpaid_transfer', now)
      await activity.record(tx, {
        category: 'system',
        action: checkoutAudit.cancelled,
        result: 'success',
        actorKind: 'job',
        actorId: null,
        actorLabel: 'Unpaid transfer',
        partnerId: order.partner_id,
        storeId: order.store_id,
        target: { type: 'order', id: order.id, label: order.number },
        reason: 'unpaid_transfer',
        api: null,
        visibility: 'store',
        requestId: null,
        ip: null,
        userAgent: null,
      })
    }
    return due.length
  })

export const paymentSetupAudit = { turnedOn: 'payment_method.turned_on', turnedOff: 'payment_method.turned_off' } as const

export interface PaymentSetupView {
  provider: PaymentProvider
  /** On, and taking payment at checkout. */
  live: boolean
  bankDetails: string | null
  /** Whether it can be turned on here today: the ways paid later now; card providers with their adapters (parts 2–3). */
  connectable: boolean
}

/** Settings › Payment setup (SetOps; THIRD-PARTY-ACCESS §3.1): the providers for the store's region, and the ways paid later. */
export const createPaymentSetup = (deps: { sql: postgres.Sql; context: TenantContext; actor: { id: string; partnerId: string }; activity: ActivityLog; facts: RequestFacts; now: () => Date }) => {
  const { sql, context, actor, activity, facts, now } = deps
  const { storeId } = context
  const entry = (action: string, provider: string): ActivityEntry => ({
    category: 'write',
    action,
    result: 'success',
    actorKind: 'person',
    actorId: actor.id,
    actorLabel: null,
    partnerId: actor.partnerId,
    storeId,
    target: { type: 'payment_method', id: provider, label: provider },
    reason: null,
    api: 'store',
    visibility: 'store',
    ...facts,
  })

  const setup = (): Promise<PaymentSetupView[]> =>
    withScope(sql, context, async (tx) => {
      const rows = await selectPaymentSetup(tx, storeId)
      return providersFor(await selectStoreCountry(tx, storeId)).map((provider) => {
        const row = rows.find((r) => r.provider === provider)
        return { provider, live: row?.status === 'live', bankDetails: row?.bank_details ?? null, connectable: placeable(provider) }
      })
    })

  /** Cash on delivery (India) or a bank transfer, with the details shoppers transfer to. */
  const turnOn = (provider: string, bankDetails: string | null | undefined): Promise<CheckoutResult<true>> => {
    const details = bankDetails?.trim() || null
    const method = isManual(provider) ? provider : null
    if (!method || (method === 'bank_transfer' && (!details || details.length > 1000))) return Promise.resolve({ ok: false, reason: 'METHOD_UNAVAILABLE' })
    return withScope(sql, context, async (tx): Promise<CheckoutResult<true>> => {
      if (!providersFor(await selectStoreCountry(tx, storeId)).includes(method)) return { ok: false, reason: 'METHOD_UNAVAILABLE' }
      await saveManualMethod(tx, storeId, method, method === 'bank_transfer' ? details : null, now())
      await activity.record(tx, entry(paymentSetupAudit.turnedOn, method))
      return { ok: true, value: true }
    })
  }

  const turnOff = (provider: string): Promise<CheckoutResult<true>> =>
    withScope(sql, context, async (tx): Promise<CheckoutResult<true>> => {
      if (!paymentProviders.some((p) => p === provider) || !(await turnOffMethod(tx, storeId, provider, now()))) return { ok: false, reason: 'NOT_FOUND' }
      await activity.record(tx, entry(paymentSetupAudit.turnedOff, provider))
      return { ok: true, value: true }
    })

  return { setup, turnOn, turnOff }
}
