'use client'

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { ShopApiError, type ShopClient } from '../platform/api/client'
import { keepShopperToken, shopperToken } from '../platform/api/tokens'
import { navigate } from '../platform/browser/router'
import { photoOf, type Photo } from '../platform/media/media'
import { useStorefront } from '../platform/store/context'
import { moneySchema, type Money } from '../pricing/money'
import { moneyFields, productPath } from '../products/summary'

// The cart (storefront ARCHITECTURE §2.1 `cart`; DESIGN §6): the Shop API's active order is the only cart state, read once
// per page and changed only by its answers. A change shows at once and the engine's answer then replaces it.

const m = `{ ${moneyFields} }`
const addressFields = 'name line1 line2 city region postalCode country phone'
export const cartFields = `id currency email phone note needsShipping checkoutStep problems readyToPay deliverable shippingOption lines { versionId quantity productName productSlug versionName photoUrl unitPrice ${m} lineTotal ${m} discount ${m} available problem gift { recipientName recipientEmail sendOn message } } subtotal ${m} discount ${m} discounts { name code amount ${m} } codes { code state } shipping ${m} shippingDiscount ${m} tax { amount ${m} pricesIncludeTax } total ${m} amountDue ${m} giftCard { applied ${m} balance ${m} expiresAt last4 } shippingAddress { ${addressFields} } billingAddress { ${addressFields} } shippingOptions { id provider service amount ${m} before ${m} minDays maxDays hours }`

const text = z.string().nullable().optional()
const count = z.number().int().nullable().optional()
const money = moneySchema.nullable().optional().catch(null)
const addressSchema = z
  .object({ name: text, line1: text, line2: text, city: text, region: text, postalCode: text, country: text, phone: text })
  .nullable()
  .optional()
  .transform((a): CartAddress | null => (a?.name && a.line1 && a.city && a.country ? { name: a.name, line1: a.line1, line2: a.line2 ?? null, city: a.city, region: a.region ?? null, postalCode: a.postalCode ?? null, country: a.country, phone: a.phone ?? null } : null))

export const cartSchema = z.object({
  id: z.string(),
  currency: z.string(),
  email: text,
  phone: text,
  note: text,
  needsShipping: z.boolean().nullable().optional(),
  checkoutStep: text,
  problems: z.array(z.string()).nullable().optional(),
  readyToPay: z.boolean().nullable().optional(),
  deliverable: z.boolean().nullable().optional(),
  shippingOption: text,
  lines: z.array(z.object({ versionId: z.string(), quantity: z.number().int().positive(), productName: text, productSlug: text, versionName: text, photoUrl: text, unitPrice: money, lineTotal: money, discount: money, available: count, problem: text, gift: z.object({ recipientName: text, recipientEmail: text, sendOn: text, message: text }).nullable().optional() })),
  subtotal: moneySchema,
  discount: money,
  discounts: z.array(z.object({ name: text, code: text, amount: money })).nullable().optional(),
  codes: z.array(z.object({ code: text, state: text })).nullable().optional(),
  shipping: money,
  shippingDiscount: money,
  tax: z.object({ amount: moneySchema, pricesIncludeTax: z.boolean() }).nullable().optional().catch(null),
  total: moneySchema,
  amountDue: moneySchema,
  giftCard: z.object({ applied: moneySchema, balance: money, expiresAt: text, last4: text }).nullable().optional().catch(null),
  shippingAddress: addressSchema,
  billingAddress: addressSchema,
  shippingOptions: z.array(z.object({ id: z.string(), provider: text, service: text, amount: moneySchema, before: money, minDays: count, maxDays: count, hours: text })).nullable().optional(),
})

export type CartAddress = { name: string; line1: string; line2: string | null; city: string; region: string | null; postalCode: string | null; country: string; phone: string | null }

/** What stops a line being bought: gone, not sold in the shopper's market, without a price, or more than is left. */
export type LineProblem = 'unavailable' | 'not_sold_here' | 'not_priced' | 'short'
const lineProblems: readonly LineProblem[] = ['unavailable', 'not_sold_here', 'not_priced', 'short']

export type CartLine = {
  versionId: string
  quantity: number
  name: string
  /** The product's page, when it is still in the catalogue. */
  href: string | null
  versionName: string | null
  photo: Photo | null
  unitPrice: Money | null
  /** Before any offer; `discount` is what the offers take off it. */
  lineTotal: Money | null
  discount: Money | null
  available: number | null
  problem: LineProblem | null
  /** A change to it the engine hasn't answered yet: its money is the last answer's until it does. */
  pending: boolean
  /** A gift card line's recipient, which the engine emails the card to. */
  gift: GiftRecipient | null
}

/** Who a gift card goes to, and when (ISO date, empty for now), with a message. */
export type GiftRecipient = { recipientName: string; recipientEmail: string; sendOn: string | null; message: string | null }

/** A way to deliver the cart (SAPI 23's quote): courier, flat or pickup. */
export type DeliveryOption = { id: string; provider: string | null; service: string | null; amount: Money; before: Money | null; minDays: number | null; maxDays: number | null; hours: string | null }

export type CheckoutStep = 'contact' | 'ship' | 'pay'

export type Cart = {
  id: string
  currency: string
  lines: CartLine[]
  /** How many items, changes not yet answered included. */
  count: number
  subtotal: Money
  discount: Money | null
  discounts: { name: string; code: string | null; amount: Money }[]
  /** Each code the cart holds and its state: APPLIED, NOT_ELIGIBLE, DOESNT_COMBINE, SIGN_IN_REQUIRED, INVALID, EXPIRED, USED_UP, ALREADY_USED. */
  codes: { code: string; state: string }[]
  shipping: Money | null
  shippingDiscount: Money | null
  tax: { amount: Money; includesTax: boolean } | null
  total: Money
  /** What is left to pay once a gift card took its part. */
  amountDue: Money
  /** The gift card paying part of it: what it takes off, what's left on it after, its last four digits. */
  giftCard: { applied: Money; balance: Money | null; expiresAt: string | null; last4: string | null } | null
  email: string | null
  phone: string | null
  note: string | null
  needsShipping: boolean
  step: CheckoutStep | null
  /** EMPTY, LINE_PROBLEM, NO_CONTACT, NO_ADDRESS, NO_SHIPPING, SHIPPING_UNAVAILABLE, TAX_UNAVAILABLE. */
  problems: string[]
  readyToPay: boolean
  deliverable: boolean | null
  shippingAddress: CartAddress | null
  billingAddress: CartAddress | null
  shippingOption: string | null
  shippingOptions: DeliveryOption[]
  /** A change the engine hasn't answered yet: totals are the last answer's until it does. */
  pending: boolean
}

type Decoded = z.infer<typeof cartSchema>
type Overlay = { id: number; versionId: string; quantity: number; kind: 'set' | 'add' }
type Snapshot = { status: 'loading' | 'ready' | 'error'; code: string | null; cart: Decoded | null; overlay: readonly Overlay[]; error: string | null }

const steps: readonly CheckoutStep[] = ['contact', 'ship', 'pay']

/** The engine's cart with the changes it hasn't answered yet laid over it; no amount is ever worked out here. */
export const viewCart = (cart: Decoded, overlay: readonly Overlay[] = []): Cart => {
  const set = new Map(overlay.filter((o) => o.kind === 'set').map((o) => [o.versionId, o.quantity]))
  const added = (v: string) => overlay.filter((o) => o.kind === 'add' && o.versionId === v).reduce((n, o) => n + o.quantity, 0)
  const lines = cart.lines.flatMap((l): CartLine[] => {
    const quantity = (set.get(l.versionId) ?? l.quantity) + added(l.versionId)
    if (quantity <= 0) return []
    const photo = l.photoUrl ? photoOf(l.photoUrl, l.productName ?? null) : null
    const problem = lineProblems.find((p) => p === l.problem) ?? null
    return [{ versionId: l.versionId, quantity, name: l.productName ?? '', href: l.productSlug ? productPath(l.productSlug) : null, versionName: l.versionName ?? null, photo, unitPrice: l.unitPrice ?? null, lineTotal: l.lineTotal ?? null, discount: l.discount ?? null, available: l.available ?? null, problem, pending: quantity !== l.quantity, gift: l.gift?.recipientName && l.gift.recipientEmail ? { recipientName: l.gift.recipientName, recipientEmail: l.gift.recipientEmail, sendOn: l.gift.sendOn ?? null, message: l.gift.message ?? null } : null }]
  })
  const known = new Set(cart.lines.map((l) => l.versionId))
  const adding = overlay.filter((o) => o.kind === 'add' && !known.has(o.versionId)).reduce((n, o) => n + o.quantity, 0)
  return {
    id: cart.id,
    currency: cart.currency,
    lines,
    count: lines.reduce((n, l) => n + l.quantity, 0) + adding,
    subtotal: cart.subtotal,
    discount: cart.discount ?? null,
    discounts: (cart.discounts ?? []).flatMap((d) => (d.name && d.amount ? [{ name: d.name, code: d.code ?? null, amount: d.amount }] : [])),
    codes: (cart.codes ?? []).flatMap((c) => (c.code && c.state ? [{ code: c.code, state: c.state }] : [])),
    shipping: cart.shipping ?? null,
    shippingDiscount: cart.shippingDiscount ?? null,
    tax: cart.tax ? { amount: cart.tax.amount, includesTax: cart.tax.pricesIncludeTax } : null,
    total: cart.total,
    amountDue: cart.amountDue,
    giftCard: cart.giftCard ? { applied: cart.giftCard.applied, balance: cart.giftCard.balance ?? null, expiresAt: cart.giftCard.expiresAt ?? null, last4: cart.giftCard.last4 ?? null } : null,
    email: cart.email ?? null,
    phone: cart.phone ?? null,
    note: cart.note ?? null,
    needsShipping: cart.needsShipping ?? true,
    step: steps.find((s) => s === cart.checkoutStep) ?? null,
    problems: cart.problems ?? [],
    readyToPay: cart.readyToPay ?? false,
    deliverable: cart.deliverable ?? null,
    shippingAddress: cart.shippingAddress,
    billingAddress: cart.billingAddress,
    shippingOption: cart.shippingOption ?? null,
    shippingOptions: (cart.shippingOptions ?? []).map((o) => ({ id: o.id, provider: o.provider ?? null, service: o.service ?? null, amount: o.amount, before: o.before ?? null, minDays: o.minDays ?? null, maxDays: o.maxDays ?? null, hours: o.hours ?? null })),
    pending: overlay.length > 0,
  }
}

const readQuery = `query Cart { cart { ${cartFields} } }`
const changeSchema = z.object({ cart: cartSchema.nullable().optional(), cartToken: text })

/** A cart mutation's answer: `ShopCartChange` (`cart`, `cartToken`), or `ShopCodeResult` with the code's `state`. */
export type CartAnswer = { cart?: Decoded | null | undefined; cartToken?: string | null | undefined; state?: string | null | undefined }

export type CartStore = ReturnType<typeof createCartStore>

const createCartStore = (client: ShopClient) => {
  let state: Snapshot = { status: 'loading', code: null, cart: null, overlay: [], error: null }
  let started = false
  let next = 0
  let queue: Promise<unknown> = Promise.resolve()
  const listeners = new Set<() => void>()
  const set = (patch: Partial<Snapshot>) => {
    state = { ...state, ...patch }
    listeners.forEach((l) => l())
  }

  const read = async () => {
    // Without a token there is no cart to read: a guest's first add makes one.
    if (!shopperToken('cart') && !shopperToken('session')) return set({ status: 'ready', code: null, cart: null })
    try {
      const { cart } = await client.query(readQuery, z.object({ cart: cartSchema.nullable() }))
      set({ status: 'ready', code: null, cart })
    } catch (error) {
      const code = error instanceof ShopApiError ? error.code : 'UNKNOWN'
      if (code === 'NO_CART') {
        keepShopperToken('cart', null)
        return set({ status: 'ready', code: null, cart: null })
      }
      set({ status: 'error', code })
    }
  }

  /** Reads and changes go one at a time, in order, so a read never lands over a newer change's answer. */
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const done = queue.then(work)
    queue = done.catch(() => undefined)
    return done
  }

  /**
   * One change at a time, in order, so each answer is newer than the last. `overlay` shows the change until the engine
   * answers; a refusal drops it and keeps the code in `error`. An expired cart is forgotten and the change asked again once.
   */
  const change = <T extends CartAnswer>(operation: string, variables: Record<string, unknown>, schema: z.ZodType<T>, overlay?: Omit<Overlay, 'id'>): Promise<T | null> => {
    const own = overlay ? { ...overlay, id: (next += 1) } : null
    if (own) set({ overlay: [...state.overlay, own], error: null })
    else set({ error: null })
    const ask = (retry: boolean): Promise<T | null> =>
      client.query(operation, z.record(z.string(), schema), variables).then(
        (data) => {
          const answer = Object.values(data)[0] ?? null
          if (answer?.cartToken) keepShopperToken('cart', answer.cartToken)
          set({ status: 'ready', code: null, ...(answer?.cart ? { cart: answer.cart } : {}), overlay: state.overlay.filter((o) => o !== own) })
          return answer
        },
        (error: unknown) => {
          const code = error instanceof ShopApiError ? error.code : 'UNKNOWN'
          if (code === 'NO_CART' && retry) {
            keepShopperToken('cart', null)
            return ask(false)
          }
          set({ overlay: state.overlay.filter((o) => o !== own), error: code, ...(code === 'NO_CART' ? { cart: null } : {}) })
          return null
        },
      )
    return inTurn(() => ask(true))
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    get: () => state,
    load: () => {
      if (started) return
      started = true
      void inTurn(read)
    },
    reload: () => {
      started = true
      set({ status: state.cart ? state.status : 'loading', code: null })
      return inTurn(read)
    },
    change,
  }
}

const stores = new WeakMap<ShopClient, CartStore>()

/** The cart's store for this client, one per page however many components show the cart. */
export const cartStoreOf = (client: ShopClient): CartStore => {
  let store = stores.get(client)
  if (!store) stores.set(client, (store = createCartStore(client)))
  return store
}

const serverSnapshot: Snapshot = { status: 'loading', code: null, cart: null, overlay: [], error: null }
const keep = () => serverSnapshot

/** The cart as the page shows it, asked for once in the browser; a static build renders it loading, as hydration does. */
export const useCartState = () => {
  const { client } = useStorefront()
  const store = cartStoreOf(client)
  const snapshot = useSyncExternalStore(store.subscribe, store.get, keep)
  useEffect(() => store.load(), [store])
  const cart = useMemo(() => (snapshot.cart ? viewCart(snapshot.cart, snapshot.overlay) : null), [snapshot.cart, snapshot.overlay])
  return { store, snapshot, cart }
}

const lineChange = (name: string, args: string) => `mutation ${name}($versionId: ID!, $quantity: Int!) { ${args} { cartToken cart { ${cartFields} } } }`
const addMutation = `mutation Add($versionId: ID!, $quantity: Int!, $gift: ShopGiftCardInput) { addToCart(versionId: $versionId, quantity: $quantity, gift: $gift) { cartToken cart { ${cartFields} } } }`
const quantityMutation = lineChange('Quantity', 'setCartQuantity(versionId: $versionId, quantity: $quantity)')
const applyMutation = `mutation Apply($code: String!) { applyCode(code: $code) { state cart { ${cartFields} } } }`
const removeCodeMutation = `mutation RemoveCode($code: String!) { removeCode(code: $code) { cart { ${cartFields} } } }`
const codeSchema = z.object({ cart: cartSchema.nullable().optional(), state: text })
const giftCardMutation = `mutation GiftCard($number: String!) { applyGiftCard(number: $number) { cart { ${cartFields} } } }`
const removeGiftCardMutation = `mutation RemoveGiftCard { removeGiftCard { cart { ${cartFields} } } }`

export type CartPage = {
  status: 'loading' | 'ready' | 'error'
  /** Why the cart didn't load. */
  code: string | null
  /** Null while loading, and when the shopper has no cart yet: an empty cart. */
  cart: Cart | null
  count: number
  /** The last change's refusal, such as UNAVAILABLE or TOO_MANY_LINES; cleared by the next change. */
  error: string | null
  /** `gift`: a gift card's recipient, which the engine needs to sell one. */
  add: (versionId: string, quantity?: number, gift?: GiftRecipient) => Promise<boolean>
  setQuantity: (versionId: string, quantity: number) => Promise<boolean>
  remove: (versionId: string) => Promise<boolean>
  /** The code's state as the engine answers it, such as APPLIED or INVALID; null when it couldn't be asked. */
  applyCode: (code: string) => Promise<string | null>
  removeCode: (code: string) => Promise<boolean>
  /** A gift card's number pays part of the cart: null once it does, else the refusal's code (GIFT_CARD_INVALID, RATE_LIMITED, NOT_IN_PREVIEW, …). */
  applyGiftCard: (number: string) => Promise<string | null>
  removeGiftCard: () => Promise<boolean>
  /** Adds the version to the cart, then opens checkout. */
  buyNow: (versionId: string, quantity?: number, gift?: GiftRecipient) => Promise<boolean>
  retry: () => void
}

/** The shopper's cart and what can be done to it (ARCHITECTURE §2.1 `cart`); nothing here prices anything. */
export const useCart = (): CartPage => {
  const { store, snapshot, cart } = useCartState()
  const add = async (versionId: string, quantity = 1, gift?: GiftRecipient) =>
    (await store.change(addMutation, { versionId, quantity, gift: gift ? { recipientName: gift.recipientName.trim(), recipientEmail: gift.recipientEmail.trim(), sendOn: gift.sendOn || null, message: gift.message?.trim() || null } : null }, changeSchema, { versionId, quantity, kind: 'add' })) !== null
  const setQuantity = async (versionId: string, quantity: number) => (await store.change(quantityMutation, { versionId, quantity }, changeSchema, { versionId, quantity, kind: 'set' })) !== null
  return {
    status: snapshot.status,
    code: snapshot.code,
    cart,
    count: cart?.count ?? 0,
    error: snapshot.error,
    add,
    setQuantity,
    remove: (versionId) => setQuantity(versionId, 0),
    applyCode: async (code) => (await store.change(applyMutation, { code }, codeSchema))?.state ?? null,
    removeCode: async (code) => (await store.change(removeCodeMutation, { code }, changeSchema)) !== null,
    applyGiftCard: async (number) => ((await store.change(giftCardMutation, { number: number.replace(/\s+/g, '') }, changeSchema)) !== null ? null : (store.get().error ?? 'UNKNOWN')),
    removeGiftCard: async () => (await store.change(removeGiftCardMutation, {}, changeSchema)) !== null,
    // The active order is the only cart (ARCHITECTURE §2.1), so buying now is adding to it and going straight to checkout.
    buyNow: async (versionId, quantity = 1, gift) => {
      const added = await add(versionId, quantity, gift)
      if (added) navigate('/checkout/')
      return added
    },
    retry: () => void store.reload(),
  }
}
