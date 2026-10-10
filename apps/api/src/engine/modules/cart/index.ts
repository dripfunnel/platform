import type postgres from 'postgres'
import type { ActivityLog, RequestFacts } from '#auth/activity'
import { hashSessionId, newSessionId } from '#auth/session'
import type { PartnerCouriers } from '#core/couriers'
import { isUuid } from '#core/ids'
import type { Money } from '#core/money'
import type { TenantContext } from '#core/tenancy'
import { insertCart, lockCartRow, selectCart, selectGuestCartId, setCartLine, updateCart, type CartAddress, type CartPatch, type CartRow } from '#db/scoped/cart'
import type { FeatureKey } from '#db/scoped/catalogListing'
import { withScope, type ScopedSql } from '#db/scoped/index'
import { selectTaxSetup, type TaxSetupRow } from '#db/scoped/tax'
import { cartOffers, deadCodeStates, normaliseCode, type CartDiscount, type CartOffersInput, type CodeState } from '#engine/modules/promotions/index'
import { createShippingService, type DeliveryOption } from '#engine/modules/shipping/index'
import { createStorefrontCatalog, type CartItem } from '#engine/modules/storefront/index'
import { computeTax, taxSettingOf, type LineTax, type StripeTaxDeps } from '#engine/modules/tax/index'
import { cartLifeMs, checkoutProblems, cleanAddress, cleanContact, maxCartLines, maxQuantity, priceLine, type AddressInput, type CheckoutProblem, type PricedLine } from './rules'

export type { AddressInput, CheckoutProblem, LineProblem } from './rules'
export { cleanAddress, cleanContact } from './rules'
export type { CartAddress } from '#db/scoped/cart'

// A shopper's cart and checkout up to payment (SAPI 9; PLATFORM-PROMPT §5.4): the cart holds what the shopper chose, and the
// engine prices it on every read, so nothing a storefront sends is ever a price (§5.5). Payment and placement are SAPI 10's.

export type CartRefusal = 'INVALID_INPUT' | 'UNAVAILABLE' | 'TOO_MANY_LINES' | 'NO_CART' | 'NOT_READY' | 'RATE_LIMITED' | 'TOO_MANY_CODES'

/** Codes a cart holds at once (migration 0078). */
export const maxCartCodes = 5
export type CartResult<T> = { ok: true; value: T } | { ok: false; reason: CartRefusal; problems?: CheckoutProblem[] }

class Refused extends Error {
  constructor(readonly reason: CartRefusal) {
    super(reason)
  }
}

export interface CartDeps {
  sql: postgres.Sql
  /** A shopper's: its account when signed in, the cart token's hash when a guest presented one. */
  context: TenantContext
  language: string
  currency: string
  marketId: string | null
  features: Readonly<Record<FeatureKey, boolean>>
  couriers: PartnerCouriers | null
  activity: ActivityLog
  facts: RequestFacts
  /** Stripe Tax on the store's connected account, for a US address (decided on #284, #337); null where none is connected. */
  stripeTax?: StripeTaxDeps | null
  /** Whether this requester may start another guest cart now (a limiter per store and IP). */
  allowNewCart: () => Promise<boolean>
  now: () => Date
}

export interface CartLineView extends PricedLine {
  item: CartItem | null
  /** What the offers take off this line; null when it isn't priced. */
  discount: Money | null
}

export interface CartView {
  id: string
  currency: string
  email: string | null
  phone: string | null
  note: string | null
  shippingAddress: CartAddress | null
  billingAddress: CartAddress | null
  shippingOption: CartRow['shipping_option']
  checkoutStep: CartRow['checkout_step']
  /** Moves with every change: placement refuses a cart changed after it was priced. */
  revision: number
  lines: CartLineView[]
  /** Before any offer. */
  subtotal: Money
  /** Each offer taken, in the order it applied, named as shoppers see it (OFFERS fact 13). */
  discounts: (Omit<CartDiscount, 'amount'> & { amount: Money })[]
  /** What the offers take off altogether, delivery's included. */
  discount: Money
  /** Each code the cart holds and what it does now (fact 6). */
  codes: { code: string; state: CodeState }[]
  /** What its offers were priced from, so placement can check them again as it counts their uses. */
  offersInput: CartOffersInput
  /** Null until there is an address to deliver to; collection in person is offered without one. */
  deliverable: boolean | null
  shippingOptions: DeliveryOption[]
  /** The chosen delivery's price, before an offer takes anything off it. */
  shipping: Money | null
  shippingDiscount: Money | null
  /** Null until the cart knows where it goes; `inclusive` when the prices already hold it (fact 6). */
  tax: { amount: Money; inclusive: boolean; lines: LineTax[] } | null
  total: Money
  /** What stands between this cart and payment; empty when it can be paid (`readyToPay`). */
  problems: CheckoutProblem[]
}

export interface CartChange {
  cart: CartView
  /** A new guest cart's token, handed out once: the storefront keeps it and sends it back (X-Shop-Cart). */
  token: string | null
}

const zero = (currency: string): Money => ({ amount: 0n, currency })

export const createCartService = (deps: CartDeps) => {
  const { sql, language, currency, marketId, now } = deps
  const { storeId } = deps.context
  const shopper = deps.context.caller.kind === 'shopper' ? deps.context.caller : null
  const customerId = shopper?.customerId ?? null
  const catalog = (context: TenantContext) => createStorefrontCatalog({ sql, context, language, currency, marketId, features: deps.features, now })

  /**
   * Stripe Tax for a US address on a store with Stripe connected, shipping included; the store's own rates otherwise, which
   * leave shipping untaxed (decided on #309). Stripe not answering is a tax not known (TAX_UNAVAILABLE), never a guess.
   */
  const taxOf = async (setup: TaxSetupRow, taxTo: { country: string; region: string | null }, postal: string | null, priced: readonly (CartLineView & { lineTotal: Money })[], shipping: bigint | null): Promise<CartView['tax']> => {
    const stripe = taxTo.country === 'US' ? (deps.stripeTax ?? null) : null
    const accountId = stripe ? await stripe.accountId() : null
    if (!stripe || !accountId) {
      const computed = computeTax(priced.map((l) => ({ id: l.versionId, amount: l.lineTotal.amount, taxClassId: l.item?.taxClassId ?? null })), taxTo, taxSettingOf(setup))
      return { amount: { amount: computed.total, currency }, inclusive: setup.tax_inclusive, lines: computed.lines }
    }
    const codeOf = (classId: string | null) => (setup.classes.find((c) => c.id === classId) ?? setup.classes.find((c) => c.is_default))?.tax_code ?? null
    try {
      const result = await stripe.calculate({
        accountId,
        currency,
        inclusive: setup.tax_inclusive,
        shipTo: { country: taxTo.country, region: taxTo.region, postal },
        lines: priced.map((l) => ({ reference: l.versionId, amount: l.lineTotal.amount, taxCode: codeOf(l.item?.taxClassId ?? null) })),
        shipping,
      })
      const lines = priced.map((l) => ({ line: l, amount: result.lines.find((r) => r.reference === l.versionId)?.amount }))
      if (lines.some((l) => l.amount === undefined)) return null
      return {
        amount: { amount: result.total, currency },
        inclusive: setup.tax_inclusive,
        lines: lines.map(({ line, amount = 0n }) => ({ id: line.versionId, rateBps: null, amount, components: amount === 0n ? [] : [{ name: 'Tax' as const, rateBps: null, amount }] })),
      }
    } catch {
      return null
    }
  }

  const view = async (context: TenantContext, row: CartRow): Promise<CartView> => {
    const items = await catalog(context).cartItems(row.lines.map((l) => l.version_id))
    const lines: CartLineView[] = row.lines.map((l) => {
      const item = items.get(l.version_id) ?? null
      const facts = item ? { price: item.version.price, available: item.version.available, inStock: item.version.inStock, continueSelling: item.version.continueSelling, soldHere: item.soldHere } : null
      return { ...priceLine({ versionId: l.version_id, quantity: l.quantity, item: facts }), item, discount: null }
    })
    const subtotal = lines.reduce<Money>((sum, l) => (l.lineTotal ? { amount: sum.amount + l.lineTotal.amount, currency } : sum), zero(currency))
    const priced = lines.filter((l): l is CartLineView & { lineTotal: Money } => l.lineTotal !== null)
    const setup = await withScope(sql, context, (tx) => selectTaxSetup(tx, storeId))
    const pickup = row.shipping_option === 'pickup'
    const address = row.shipping_address
    const shipping = createShippingService({ sql, context, actor: { id: customerId ?? 'guest', partnerId: context.partnerId }, activity: deps.activity, facts: deps.facts, now, couriers: deps.couriers })
    let shippingOptions: DeliveryOption[] = []
    let deliverable: boolean | null = null
    // Without an address, only collection from the store's own country can be quoted; a store with none offers nothing yet.
    const shipTo = address ? { country: address.country, region: address.region, postal: address.postalCode } : setup?.country ? { country: setup.country, region: null, postal: null } : null
    if (priced.length > 0 && shipTo) {
      const quoted = await shipping.quote({ lines: priced.map((l) => ({ versionId: l.versionId, quantity: l.quantity })), shipTo, subtotal, marketId })
      if (quoted.ok) {
        // Without an address only collection in person can be priced honestly.
        shippingOptions = address ? quoted.value.options : quoted.value.options.filter((o) => o.id === 'pickup')
        deliverable = address ? quoted.value.deliverable : null
      }
    }
    const chosen = shippingOptions.find((o) => o.id === row.shipping_option) ?? null
    const offersInput: CartOffersInput = {
      storeId,
      currency,
      codes: row.promotion_codes,
      customerId: row.customer_id,
      email: row.email,
      phone: row.phone,
      country: address?.country ?? null,
      lines: priced.flatMap((l) => (l.item ? [{ versionId: l.versionId, productId: l.item.product.id, quantity: l.quantity, amount: l.lineTotal.amount, giftCard: l.item.product.productType === 'gift_card', onSale: l.item.version.compareAt !== null }] : [])),
      shipping: chosen?.amount.amount ?? null,
      now: now(),
    }
    const offers = await cartOffers(sql, offersInput)
    for (const l of lines) l.discount = l.lineTotal ? { amount: offers.pricing.lineDiscounts.get(l.versionId) ?? 0n, currency } : null
    // Tax is on what each line and the delivery come to after their offers (OFFERS fact 11).
    const afterOffers = priced.map((l) => ({ ...l, lineTotal: { amount: l.lineTotal.amount - (l.discount?.amount ?? 0n), currency } }))
    const shippingDue = chosen ? chosen.amount.amount - offers.pricing.shippingDiscount : null
    // Tax follows where the goods go: the address, or the store itself for collection (CATALOG fact 37).
    const taxTo = pickup ? (setup?.country ? { country: setup.country, region: setup.region } : null) : address ? { country: address.country, region: address.region } : null
    const tax = setup && taxTo ? await taxOf(setup, taxTo, pickup ? null : (address?.postalCode ?? null), afterOffers, shippingDue) : null
    const total = subtotal.amount - offers.pricing.discount + (chosen?.amount.amount ?? 0n) + (tax && !tax.inclusive ? tax.amount.amount : 0n)
    const problems = checkoutProblems({
      lines,
      hasContact: Boolean(row.email || row.phone),
      shippingOption: row.shipping_option,
      hasShippingAddress: address !== null,
      optionOffered: chosen !== null,
      taxKnown: tax !== null,
    })
    return {
      id: row.id,
      currency,
      email: row.email,
      phone: row.phone,
      note: row.shopper_note,
      shippingAddress: address,
      billingAddress: row.billing_address,
      shippingOption: row.shipping_option,
      checkoutStep: row.checkout_step,
      revision: row.revision,
      lines,
      subtotal,
      discounts: offers.discounts.map((d) => ({ ...d, amount: { amount: d.amount, currency } })),
      discount: { amount: offers.pricing.discount, currency },
      codes: offers.codes,
      offersInput,
      deliverable,
      shippingOptions,
      shipping: chosen?.amount ?? null,
      shippingDiscount: chosen ? { amount: offers.pricing.shippingDiscount, currency } : null,
      tax,
      total: { amount: total, currency },
      problems,
    }
  }

  const expiry = () => new Date(now().getTime() + cartLifeMs)
  const write = (tx: ScopedSql, row: CartRow, patch: CartPatch) =>
    updateCart(tx, row.id, { ...patch, ...(row.checkout_step === 'pay' && !('checkoutStep' in patch) ? { checkoutStep: 'ship' as const } : {}) }, { currency, marketId, language, expiresAt: expiry(), now: now() })

  /** The shopper's cart, priced now; null when it has none. */
  const cart = async (): Promise<CartView | null> => {
    const row = await withScope(sql, deps.context, (tx) => selectCart(tx, storeId, now()))
    return row ? view(deps.context, row) : null
  }

  const change = async (work: (tx: ScopedSql, row: CartRow) => Promise<void>): Promise<CartResult<CartChange>> => {
    try {
      const row = await withScope(sql, deps.context, async (tx) => {
        const seen = await selectCart(tx, storeId, now())
        if (!seen) throw new Refused('NO_CART')
        // Read again under the row's lock, so a change works on what the last one left (two tabs, two codes).
        await lockCartRow(tx, storeId, seen.id)
        const found = await selectCart(tx, storeId, now())
        if (!found) throw new Refused('NO_CART')
        await work(tx, found)
        return selectCart(tx, storeId, now())
      })
      if (!row) return { ok: false, reason: 'NO_CART' }
      return { ok: true, value: { cart: await view(deps.context, row), token: null } }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  /**
   * "Add to cart": the shopper's cart, or a new one: a signed-in shopper's on its account, a guest's behind a new token
   * handed back once. Only a version shoppers can see is added.
   */
  const add = async (versionId: string, quantity: number): Promise<CartResult<CartChange>> => {
    const id = versionId.toLowerCase()
    if (!isUuid(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > maxQuantity) return { ok: false, reason: 'INVALID_INPUT' }
    if (!(await catalog(deps.context).cartItems([id])).has(id)) return { ok: false, reason: 'UNAVAILABLE' }
    let context = deps.context
    let token: string | null = null
    const existing = await withScope(sql, context, (tx) => selectCart(tx, storeId, now()))
    if (!existing && customerId === null) {
      if (!(await deps.allowNewCart())) return { ok: false, reason: 'RATE_LIMITED' }
      token = newSessionId()
      context = { ...context, caller: { kind: 'shopper', customerId: null, orderTokenHash: await hashSessionId(token) } }
    }
    try {
      const row = await withScope(sql, context, async (tx) => {
        let found = await selectCart(tx, storeId, now())
        if (!found) {
          const tokenHash = context.caller.kind === 'shopper' ? (context.caller.orderTokenHash ?? null) : null
          await insertCart(tx, storeId, { customerId, tokenHash: customerId === null ? tokenHash : null, currency, marketId, language, expiresAt: expiry() })
          found = await selectCart(tx, storeId, now())
          if (!found) throw new Refused('NO_CART')
        }
        const held = found.lines.find((l) => l.version_id === id)?.quantity ?? 0
        if (!held && found.lines.length >= maxCartLines) throw new Refused('TOO_MANY_LINES')
        await setCartLine(tx, storeId, found.id, id, Math.min(held + quantity, maxQuantity))
        await write(tx, found, {})
        return selectCart(tx, storeId, now())
      })
      if (!row) return { ok: false, reason: 'NO_CART' }
      return { ok: true, value: { cart: await view(context, row), token } }
    } catch (error) {
      if (error instanceof Refused) return { ok: false, reason: error.reason }
      throw error
    }
  }

  /** How many of a version; 0 takes it out. */
  const setQuantity = (versionId: string, quantity: number) =>
    change(async (tx, row) => {
      const id = versionId.toLowerCase()
      if (!isUuid(id) || !Number.isInteger(quantity) || quantity < 0 || quantity > maxQuantity || !row.lines.some((l) => l.version_id === id)) throw new Refused('INVALID_INPUT')
      await setCartLine(tx, storeId, row.id, id, quantity)
      await write(tx, row, {})
    })

  const setContact = (input: { email?: string | null | undefined; phone?: string | null | undefined; note?: string | null | undefined }) =>
    change(async (tx, row) => {
      const contact = cleanContact(input)
      const note = input.note?.trim() || null
      if (!contact || (note?.length ?? 0) > 1000) throw new Refused('INVALID_INPUT')
      await write(tx, row, { ...contact, shopperNote: note, checkoutStep: row.checkout_step === 'ship' || row.checkout_step === 'pay' ? 'ship' : 'contact' })
    })

  const setShippingAddress = (input: AddressInput) =>
    change(async (tx, row) => {
      const address = cleanAddress(input)
      if (!address) throw new Refused('INVALID_INPUT')
      await write(tx, row, { shippingAddress: address, checkoutStep: 'ship' })
    })

  /** Null bills the delivery address. */
  const setBillingAddress = (input: AddressInput | null) =>
    change(async (tx, row) => {
      const address = input ? cleanAddress(input) : null
      if (input && !address) throw new Refused('INVALID_INPUT')
      await write(tx, row, { billingAddress: address })
    })

  /** One of the options the cart is offered; checkout refuses one no longer offered. */
  const setShippingOption = (option: string) =>
    change(async (tx, row) => {
      if (option !== 'courier' && option !== 'flat' && option !== 'pickup') throw new Refused('INVALID_INPUT')
      await write(tx, row, { shippingOption: option, checkoutStep: 'ship' })
    })

  /**
   * "Discount code or coupon": the code goes on the cart and the cart is priced with it. One that can't work whatever is
   * added (unknown, ended, used up, already used by this shopper) comes straight back off, with its state.
   */
  const applyCode = async (raw: string): Promise<CartResult<{ state: CodeState; cart: CartView }>> => {
    const code = normaliseCode(raw)
    const current = await withScope(sql, deps.context, (tx) => selectCart(tx, storeId, now()))
    if (!current) return { ok: false, reason: 'NO_CART' }
    if (!code) return { ok: true, value: { state: 'INVALID', cart: await view(deps.context, current) } }
    const without = (codes: readonly string[]) => codes.filter((c) => c.toLowerCase() !== code.toLowerCase())
    const added = await change(async (tx, row) => {
      const held = without(row.promotion_codes)
      if (held.length >= maxCartCodes) throw new Refused('TOO_MANY_CODES')
      await write(tx, row, { promotionCodes: [...held, code] })
    })
    if (!added.ok) return added
    const state = added.value.cart.codes.find((c) => c.code === code)?.state ?? 'INVALID'
    if (!deadCodeStates.includes(state)) return { ok: true, value: { state, cart: added.value.cart } }
    const removed = await change(async (tx, row) => {
      await write(tx, row, { promotionCodes: without(row.promotion_codes) })
    })
    return removed.ok ? { ok: true, value: { state, cart: removed.value.cart } } : removed
  }

  const removeCode = (raw: string) =>
    change(async (tx, row) => {
      await write(tx, row, { promotionCodes: row.promotion_codes.filter((c) => c.toLowerCase() !== raw.trim().toLowerCase()) })
    })

  /** "Continue to payment": everything priced and chosen, or the reasons it isn't. */
  const checkout = async (): Promise<CartResult<CartView>> => {
    const current = await cart()
    if (!current) return { ok: false, reason: 'NO_CART' }
    if (current.problems.length > 0) return { ok: false, reason: 'NOT_READY', problems: current.problems }
    const moved = await change(async (tx, row) => {
      await write(tx, row, { checkoutStep: 'pay' })
    })
    return moved.ok ? { ok: true, value: moved.value.cart } : moved
  }

  /**
   * On sign-in, the guest cart this request holds the token of becomes the account's (its customer set to the shopper's
   * own, which the policy allows only with the token). Its token stays, so the browser's next call still finds it.
   */
  const claim = async (): Promise<boolean> => {
    if (customerId === null || !shopper?.orderTokenHash) return false
    return withScope(sql, deps.context, async (tx) => {
      const guest = await selectGuestCartId(tx, storeId)
      if (!guest) return false
      return updateCart(tx, guest, { customerId }, { currency, marketId, language, expiresAt: expiry(), now: now() })
    })
  }

  return { cart, add, setQuantity, setContact, setShippingAddress, setBillingAddress, setShippingOption, applyCode, removeCode, checkout, claim }
}
