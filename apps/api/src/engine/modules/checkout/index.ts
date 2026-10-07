import type postgres from 'postgres'
import type { ActivityEntry, ActivityLog, RequestFacts } from '#auth/activity'
import type { SecretBox } from '#auth/secretBox'
import { isUuid } from '#core/ids'
import { logEvent } from '#core/log'
import type { Money } from '#core/money'
import { isCardProvider, PaymentRefused, PaymentUnavailable, type CardProvider, type OAuthConnect, type PaymentGateways, type PaymentMode, type PaymentStart } from '#core/payments'
import type { TenantContext } from '#core/tenancy'
import { withScope, withSystemScope, type ScopedSql } from '#db/scoped/index'
import {
  insertPayment,
  lockCart,
  lockPlacedOrder,
  recordPaid,
  reserveLine,
  selectLivePaymentAccounts,
  selectShopOrder,
  selectSnapshotVersions,
  takeOrderNumber,
  writeSnapshot,
  type PaymentAccountRow,
  type SnapshotLine,
} from '#db/scoped/orders'
import { failPendingPayments, selectGatewayAccount } from '#db/scoped/payments'
import { createCartService, type CartDeps, type CartView, type CheckoutProblem } from '#engine/modules/cart/index'
import type { StripeTaxDeps } from '#engine/modules/tax/index'
import { settleOrder, type SettleDeps } from './payments'
import { cardPaymentMs, isManual, kindOf, openAccount, paymentProviders, providersFor, transferDaysMs, type PaymentKind, type PaymentProvider } from './providers'

// Placing an order and paying for it (SAPI 10; PLATFORM-PROMPT §5.4 Payments). The cart is priced as its shopper, then the
// snapshot, number, held stock and payment are written in system scope, as nothing a shopper writes may be a price or state.

export { applyOutcome, handleMerchantStripeEvent, paymentAudit, releaseUnpaidOrders, settleOrder, settlePayment, type MerchantEventOutcome, type SettleDeps, type Settled } from './payments'
export { cardPaymentMs, isPaymentProvider, paymentProviders, providersFor, transferDaysMs, type PaymentProvider } from './providers'
export { createPaymentSetup, paymentSetupAudit, type PaymentSetupDeps, type PaymentSetupView } from './setup'
export type { ShopOrderRow } from '#db/scoped/orders'

/** What the Worker wires in for payments: the card adapters, Connect Stripe, and Stripe Tax in each mode (null where unset). */
export interface PaymentWiring {
  gateways: PaymentGateways
  stripeConnect: OAuthConnect | null
  stripeTax: (mode: PaymentMode) => StripeTaxDeps['calculate'] | null
}

export const checkoutAudit = { placed: 'order.placed', retried: 'order.payment_retried', markedPaid: 'order.marked_paid', cancelled: 'order.cancelled' } as const

export type CheckoutRefusal = 'NOT_READY' | 'METHOD_UNAVAILABLE' | 'PAYMENT_UNAVAILABLE' | 'ALREADY_PLACED' | 'ALREADY_PAID' | 'CART_CHANGED' | 'READ_ONLY' | 'OUT_OF_STOCK' | 'NOT_FOUND' | 'NOT_PENDING'
export type CheckoutResult<T> = { ok: true; value: T } | { ok: false; reason: CheckoutRefusal; problems?: CheckoutProblem[] }

class Refused extends Error {
  constructor(readonly reason: CheckoutRefusal) {
    super(reason)
  }
}

export interface PaymentOption {
  provider: PaymentProvider
  kind: PaymentKind
  /** What the shopper needs to pay: a transfer's bank details. */
  instructions: string | null
  /** Test on a preview storefront, live otherwise. */
  mode: PaymentMode
  /** What the provider's own field or button starts with: a publishable key or client id. */
  publicKey: string | null
}

export interface PlacedOrder {
  orderId: string
  number: string
  total: Money
  provider: PaymentProvider
  instructions: string | null
  /** A card provider's payment, for the storefront to take; null for the ways paid later. */
  payment: PaymentStart | null
}

export interface CheckoutDeps extends CartDeps {
  /** The store's country, for which providers may take payment there. */
  country: string | null
  mode: PaymentMode
  gateways: PaymentGateways
  /** Opens the store's pasted keys for a call (THIRD-PARTY-ACCESS §3.1); null where the credential key isn't set. */
  secrets: SecretBox | null
  /** The storefront page a provider that takes the shopper away sends them back to. */
  returnUrl: (orderId: string) => string
}

// In the region's own order, as Payment setup lists them.
const rank = (country: string | null, provider: string) => providersFor(country).findIndex((p) => p === provider)

/** The ways to pay at checkout: the ways paid later in either mode; a card provider where its adapter takes this mode. */
const optionsOf = (accounts: readonly PaymentAccountRow[], country: string | null, mode: PaymentMode, gateways: PaymentGateways): PaymentOption[] => {
  const seen = new Set<string>()
  return [...accounts]
    .sort((a, b) => rank(country, a.provider) - rank(country, b.provider))
    .flatMap((a) => {
      const provider = paymentProviders.find((p) => p === a.provider)
      if (!provider || seen.has(provider) || !providersFor(country).includes(provider)) return []
      if (isCardProvider(provider) && !(gateways[provider]?.available(mode) && (provider === 'stripe' || a.mode === mode))) return []
      seen.add(provider)
      return [{ provider, kind: kindOf(provider), instructions: provider === 'bank_transfer' ? a.bank_details : null, mode, publicKey: isCardProvider(provider) ? a.public_key : null }]
    })
}

/** A courier's own service name; flat delivery and collection have none, as the storefront words them (no literal text here). */
const shippingLabel = (cart: CartView): string | null => {
  const chosen = cart.shippingOptions.find((o) => o.id === cart.shippingOption)
  return chosen?.id === 'courier' && chosen.service ? chosen.service : null
}

export const createCheckout = (deps: CheckoutDeps) => {
  const { sql, context, now, activity, facts, mode } = deps
  const { storeId } = context
  const customerId = context.caller.kind === 'shopper' ? context.caller.customerId : null
  const settleDeps: SettleDeps = { sql, activity, gateways: deps.gateways, secrets: deps.secrets, now }

  const options = (): Promise<PaymentOption[]> => withScope(sql, context, async (tx) => optionsOf(await selectLivePaymentAccounts(tx, storeId), deps.country, mode, deps.gateways))

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
    reason: mode === 'test' ? 'test' : null,
    api: 'shop',
    visibility: 'store',
    ...facts,
  })

  /** A card payment started with the store's account in this mode; the attempt's id is the payment row's, written after. */
  const begin = async (provider: CardProvider, orderId: string, amount: Money, customer: { email: string | null; phone: string | null }): Promise<CheckoutResult<{ attemptId: string; accountId: string; started: PaymentStart }>> => {
    const gateway = deps.gateways[provider]
    const row = await withSystemScope(sql, (tx) => selectGatewayAccount(tx, storeId, provider, mode))
    const account = row ? await openAccount(row, mode, deps.secrets) : null
    if (!row || !gateway || !account || !gateway.available(mode)) return { ok: false, reason: 'METHOD_UNAVAILABLE' }
    const attemptId = crypto.randomUUID()
    try {
      return { ok: true, value: { attemptId, accountId: row.id, started: await gateway.start(account, { attemptId, orderId, amount, customer, returnUrl: deps.returnUrl(orderId) }) } }
    } catch (error) {
      if (error instanceof PaymentUnavailable) return { ok: false, reason: 'PAYMENT_UNAVAILABLE' }
      if (!(error instanceof PaymentRefused)) throw error
      // The store's account needs fixing, which the shopper can't do: said to them as unavailable, logged for the merchant's partner.
      logEvent({ event: 'payment_refused', api: 'shop', storeId, code: provider })
      return { ok: false, reason: 'METHOD_UNAVAILABLE' }
    }
  }

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

  /** "Pay" (FIRST-RELEASE §19): a card payment is started before placing, so no order exists that couldn't be paid. */
  const place = async (provider: string): Promise<CheckoutResult<PlacedOrder>> => {
    const cart = await createCartService(deps).cart()
    if (!cart) return { ok: false, reason: 'NOT_FOUND' }
    // Sold out since the shopper reached payment: said as such, however the race fell (before the lock or under it).
    if (cart.lines.some((l) => l.problem === 'short' || l.problem === 'unavailable')) return { ok: false, reason: 'OUT_OF_STOCK' }
    if (cart.problems.length > 0 || cart.checkoutStep !== 'pay') return { ok: false, reason: 'NOT_READY', problems: cart.problems }
    const option = (await options()).find((o) => o.provider === provider)
    if (!option) return { ok: false, reason: 'METHOD_UNAVAILABLE' }
    let card: { attemptId: string; accountId: string; started: PaymentStart } | null = null
    if (isCardProvider(option.provider)) {
      const begun = await begin(option.provider, cart.id, cart.total, { email: cart.email, phone: cart.phone })
      if (!begun.ok) return begun
      card = begun.value
    }
    const manualAccountId = card ? null : ((await withScope(sql, context, (tx) => selectLivePaymentAccounts(tx, storeId))).find((a) => a.provider === option.provider)?.id ?? null)
    try {
      return await withSystemScope(sql, async (tx) => {
        const locked = await lockCart(tx, storeId, cart.id)
        if (!locked) throw new Refused('ALREADY_PLACED')
        // Changed in another tab since it was priced: the shopper sees the new cart before paying for it.
        if (locked.revision !== cart.revision) throw new Refused('CART_CHANGED')
        const holds = isManual(option.provider) && mode === 'live'
        const lines = await snapshotLines(tx, cart, holds)
        const parts = [...new Map(lines.map((l) => [l.sellerId ?? 'store', l.sellerId])).values()]
        const modes = new Map((await selectSnapshotVersions(tx, storeId, lines.map((l) => l.versionId))).map((v) => [v.seller_id ?? 'store', v.shipping_mode]))
        const number = await takeOrderNumber(tx, storeId)
        const at = now()
        const dueIn = option.provider === 'bank_transfer' ? transferDaysMs : card ? cardPaymentMs : null
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
          paymentDueBy: dueIn === null ? null : new Date(at.getTime() + dueIn),
          stockReserved: holds,
          now: at,
        })
        await insertPayment(tx, {
          ...(card ? { id: card.attemptId } : {}),
          orderId: cart.id,
          storeId,
          provider: option.provider,
          accountId: card?.accountId ?? manualAccountId,
          kind: option.kind,
          amount: cart.total.amount,
          currency: cart.currency,
          mode,
          providerRef: card?.started.providerRef ?? null,
        })
        await activity.record(tx, placedEntry(cart.id, number))
        return { ok: true as const, value: { orderId: cart.id, number, total: cart.total, provider: option.provider, instructions: option.instructions, payment: card?.started ?? null } }
      })
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  /** A shopper's own placed order, for the confirmation and order pages. */
  const order = (orderId: string) => (isUuid(orderId) ? withScope(sql, context, (tx) => selectShopOrder(tx, storeId, orderId.toLowerCase())) : Promise.resolve(null))

  /** Back from paying, or asked again: the order's card payment read back from its provider, and the order as it is now. */
  const confirm = async (orderId: string) => {
    const mine = await order(orderId)
    if (!mine) return null
    if (mine.state === 'placed' && mine.payment_state === 'pending' && mine.payment_method && isCardProvider(mine.payment_method)) {
      try {
        await settleOrder(settleDeps, storeId, mine.id)
      } catch (error) {
        // The provider is slow: the webhook or the next look settles it, and the shopper sees it still pending.
        if (!(error instanceof PaymentUnavailable)) throw error
      }
      return order(mine.id)
    }
    return mine
  }

  /** "Try again" after a card was declined or the shopper left: a new attempt for the same order, unless it got paid meanwhile. */
  const pay = async (orderId: string): Promise<CheckoutResult<PaymentStart>> => {
    const mine = await order(orderId)
    if (!mine || mine.state !== 'placed') return { ok: false, reason: 'NOT_FOUND' }
    if (mine.payment_state !== 'pending') return { ok: false, reason: 'ALREADY_PAID' }
    const method = mine.payment_method
    if (!method || !isCardProvider(method)) return { ok: false, reason: 'NOT_PENDING' }
    try {
      const settled = await settleOrder(settleDeps, storeId, mine.id)
      if (settled === 'paid' || settled === 'already' || settled === 'mismatch') return { ok: false, reason: 'ALREADY_PAID' }
    } catch (error) {
      if (error instanceof PaymentUnavailable) return { ok: false, reason: 'PAYMENT_UNAVAILABLE' }
      throw error
    }
    const amount = { amount: BigInt(mine.total_amount), currency: mine.currency }
    const begun = await begin(method, mine.id, amount, { email: null, phone: null })
    if (!begun.ok) return begun
    const { attemptId, accountId, started } = begun.value
    return withSystemScope(sql, async (tx): Promise<CheckoutResult<PaymentStart>> => {
      const locked = await lockPlacedOrder(tx, storeId, mine.id)
      if (!locked || locked.state !== 'placed') return { ok: false, reason: 'NOT_FOUND' }
      if (locked.payment_state !== 'pending') return { ok: false, reason: 'ALREADY_PAID' }
      await failPendingPayments(tx, storeId, mine.id, now())
      await insertPayment(tx, { id: attemptId, orderId: mine.id, storeId, provider: method, accountId, kind: 'card', amount: amount.amount, currency: amount.currency, mode, providerRef: started.providerRef })
      await activity.record(tx, { ...placedEntry(mine.id, mine.number), action: checkoutAudit.retried })
      return { ok: true, value: started }
    })
  }

  return { options, place, order, confirm, pay }
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
