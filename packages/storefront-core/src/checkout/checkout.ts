'use client'

import { useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { z } from 'zod'
import { cartFields, cartSchema, useCartState, type Cart, type CartAddress } from '../cart/cart'
import { ShopApiError, type ShopClient } from '../platform/api/client'
import { navigate } from '../platform/browser/router'
import { useShopData } from '../platform/render/data'
import { useStorefront, type RenderMode } from '../platform/store/context'
import { moneySchema, type Money } from '../pricing/money'
import { addressInput, addressProblems, compact, emailPattern, isPhone, type AddressDraft, type AddressField, type FieldProblem } from './address'
import { browserSdk, paymentAdapters, type PaySession, type PaymentStart, type Sdk } from './payments'

// The checkout controller (storefront ARCHITECTURE §2.1 `checkout`; DESIGN §6): contact → delivery address → delivery →
// payment → review, the engine deciding what each step needs. The theme skins each step; nothing here prices anything.

export type CheckoutStepId = 'contact' | 'address' | 'delivery' | 'payment' | 'review'

/** A way the store takes payment (ShopPaymentOption); `test` in the preview's test mode (PREVIEW §5 step 6). */
export type PaymentChoice = { provider: string; kind: string; instructions: string | null; test: boolean }

/** Where placing and paying stand: a provider's window or field is open while `paying`. */
export type PayPhase =
  | { kind: 'idle' }
  | { kind: 'placing' }
  | { kind: 'paying'; orderId: string; amount: Money; submit: (() => void) | null; note: string | null; submitting: boolean }
  | { kind: 'leaving'; orderId: string }
  | { kind: 'confirming'; orderId: string }
  | { kind: 'failed'; orderId: string | null; amount: Money | null; code: string; message: string | null }

type State = { phase: PayPhase; editing: CheckoutStepId | null; chosen: string | null; host: HTMLElement | null; busy: boolean; error: string | null; problems: string[]; instructions: string | null }

const optionsQuery = `query PaymentOptions { paymentOptions { provider kind instructions mode publicKey } store { markets { id countries } } }`
const optionsSchema = z.object({
  paymentOptions: z.array(z.object({ provider: z.string(), kind: z.string(), instructions: z.string().nullable().optional(), mode: z.string().nullable().optional() })).nullable(),
  store: z.object({ markets: z.array(z.object({ countries: z.array(z.string()).nullable().optional() })).nullable().optional() }).nullable().optional(),
})
const startFields = 'providerRef publicKey accountId clientSecret sessionId redirectUrl'
const startSchema = z.object({ providerRef: z.string(), publicKey: z.string().nullable().optional(), accountId: z.string().nullable().optional(), clientSecret: z.string().nullable().optional(), sessionId: z.string().nullable().optional(), redirectUrl: z.string().nullable().optional() }).transform((s): PaymentStart => ({ providerRef: s.providerRef, publicKey: s.publicKey ?? null, accountId: s.accountId ?? null, clientSecret: s.clientSecret ?? null, sessionId: s.sessionId ?? null, redirectUrl: s.redirectUrl ?? null }))
const placeMutation = `mutation Place($provider: String!) { placeOrder(provider: $provider) { orderId total { amount currency } instructions payment { ${startFields} } } }`
const placeSchema = z.object({ placeOrder: z.object({ orderId: z.string(), total: moneySchema, instructions: z.string().nullable().optional(), payment: startSchema.nullable().optional() }) })
const payMutation = `mutation Pay($orderId: ID!) { payOrder(orderId: $orderId) { ${startFields} } }`
const confirmMutation = `mutation Confirm($orderId: ID!) { confirmPayment(orderId: $orderId) { id } }`
const contactMutation = `mutation Contact($email: String, $phone: String) { setCartContact(email: $email, phone: $phone) { cart { ${cartFields} } } }`
const addressMutation = `mutation Address($address: ShopAddressInput!) { setShippingAddress(address: $address) { cart { ${cartFields} } } }`
const deliveryMutation = `mutation Delivery($option: String!) { setShippingOption(option: $option) { cart { ${cartFields} } } }`
const checkoutMutation = `mutation Checkout { checkout { ${cartFields} } }`
const changeSchema = z.object({ cart: cartSchema.nullable().optional() })

/** The order's own page, where the shopper lands after paying or coming back from a provider (#313: `/order/{id}/`). */
export const orderPath = (orderId: string) => `/order/${encodeURIComponent(orderId)}/`

/** Tests give their own providers' SDKs; the storefront loads the real ones (payments.ts). */
export const checkoutSdk: { current: Sdk } = { current: browserSdk }

const createCheckoutStore = () => {
  let state: State = { phase: { kind: 'idle' }, editing: null, chosen: null, host: null, busy: false, error: null, problems: [], instructions: null }
  const listeners = new Set<() => void>()
  return {
    subscribe: (l: () => void) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    get: () => state,
    set: (patch: Partial<State>) => {
      state = { ...state, ...patch }
      listeners.forEach((l) => l())
    },
  }
}
type CheckoutStore = ReturnType<typeof createCheckoutStore>
const stores = new WeakMap<ShopClient, CheckoutStore>()
const checkoutStoreOf = (client: ShopClient) => {
  let s = stores.get(client)
  if (!s) stores.set(client, (s = createCheckoutStore()))
  return s
}

const serverState: State = { phase: { kind: 'idle' }, editing: null, chosen: null, host: null, busy: false, error: null, problems: [], instructions: null }

/** The payment phase and the host the sealed payment element gives the provider, shared by every checkout component. */
export const useCheckoutState = () => {
  const { client } = useStorefront()
  const store = checkoutStoreOf(client)
  return { store, state: useSyncExternalStore(store.subscribe, store.get, () => serverState) }
}

const codeOf = (error: unknown) => (error instanceof ShopApiError ? error.code : 'UNKNOWN')

/** The steps a cart needs, each done, open or still to come; without anything to send, no address or delivery. */
const stepsOf = (cart: Cart | null, s: State): { id: CheckoutStepId; state: 'done' | 'open' | 'later' }[] => {
  // A store with exactly one delivery option has it applied for the shopper (useCheckout), so the delivery step is
  // omitted; with several the shopper still chooses it, and with none the step shows why it can't be delivered.
  const soleApplied = cart !== null && cart.shippingOptions.length === 1 && cart.shippingOption !== null
  const ids: CheckoutStepId[] = cart && !cart.needsShipping ? ['contact', 'payment', 'review'] : soleApplied ? ['contact', 'address', 'payment', 'review'] : ['contact', 'address', 'delivery', 'payment', 'review']
  const done = (id: CheckoutStepId) =>
    cart !== null &&
    (id === 'contact' ? cart.email !== null : id === 'address' ? cart.shippingAddress !== null : id === 'delivery' ? cart.shippingOption !== null : id === 'payment' ? s.chosen !== null && cart.readyToPay : false)
  const open = s.editing ?? ids.find((id) => !done(id)) ?? 'review'
  return ids.map((id) => ({ id, state: id === open ? 'open' : done(id) ? 'done' : 'later' }))
}

export type CheckoutPage = {
  status: 'loading' | 'ready' | 'empty' | 'error'
  code: string | null
  retry: () => void
  cart: Cart | null
  steps: { id: CheckoutStepId; state: 'done' | 'open' | 'later' }[]
  open: CheckoutStepId
  /** "Change" on a finished step. */
  edit: (id: CheckoutStepId) => void
  /** A change is being sent; the theme may show it and keep its buttons from sending twice. */
  busy: boolean
  /** The last refusal's code (OUT_OF_STOCK, PHONE_REQUIRED, …), with the engine's `problems` when it isn't ready. */
  error: string | null
  problems: string[]
  saveContact: (c: { email: string; phone: string }) => Promise<Partial<Record<'email' | 'phone', FieldProblem>>>
  countries: string[]
  saveAddress: (a: AddressDraft) => Promise<Partial<Record<AddressField, FieldProblem>>>
  chooseDelivery: (option: string) => Promise<boolean>
  payments: PaymentChoice[]
  chosen: string | null
  choosePayment: (provider: string) => void
  /** Payment's Continue: the engine checks everything it needs and the review opens. */
  review: () => Promise<boolean>
  /** "Pay" or "Place order"; in the studio frame it does nothing (the placeholder says why). */
  place: () => Promise<void>
  /** "Try again" after a declined or abandoned payment. */
  payAgain: () => Promise<void>
  phase: PayPhase
  /** The store's preview: every payment is a provider's test payment (PREVIEW §5 step 6). */
  test: boolean
  mode: RenderMode
}

/** An address the cart holds as a draft to edit. */
export const addressDraft = (a: CartAddress | null, country: string): AddressDraft => ({ name: a?.name ?? '', line1: a?.line1 ?? '', line2: a?.line2 ?? '', city: a?.city ?? '', region: a?.region ?? '', postalCode: a?.postalCode ?? '', country: a?.country ?? country, phone: a?.phone ?? '', pin: a?.pin ?? null })

type Payer = { store: CheckoutStore; mode: RenderMode; locale: string; test: boolean; contact: { email: string | null; phone: string | null; name: string | null }; paid: (orderId: string) => Promise<void> }

/** A placed order's payment through its provider's adapter, in the sealed element's host; `paid` runs once it went through. */
const takePayment = async (p: Payer, orderId: string, amount: Money, start: PaymentStart, provider: string): Promise<void> => {
  const { store } = p
  const adapter = paymentAdapters[provider]
  const host = store.get().host
  if (!adapter || !host) return store.set({ phase: { kind: 'failed', orderId, amount, code: 'METHOD_UNAVAILABLE', message: null } })
  let session: PaySession
  try {
    session = await adapter({ orderId, start, amount, returnUrl: `${location.origin}${orderPath(orderId)}`, test: p.test, wallets: p.mode === 'live', locale: p.locale, host, contact: p.contact }, checkoutSdk.current)
  } catch {
    return store.set({ phase: { kind: 'failed', orderId, amount, code: 'PAYMENT_UNAVAILABLE', message: null } })
  }
  const submit = session.submit
  // Pay is held while its press is answered, so one press confirms once.
  const paying = (note: string | null, submitting: boolean): void =>
    store.set({ phase: { kind: 'paying', orderId, amount, note, submitting, submit: submit && !submitting ? press : null } })
  let pressed = false
  const press = () => {
    if (pressed) return
    pressed = true
    paying(null, true)
    void submit?.().then((n) => {
      pressed = false
      if (store.get().phase.kind === 'paying') paying(n, false)
    })
  }
  paying(null, false)
  const outcome = await session.outcome
  if (outcome.kind === 'paid') return p.paid(orderId)
  if (outcome.kind === 'away') return store.set({ phase: { kind: 'leaving', orderId } })
  session.close()
  store.set({ phase: { kind: 'failed', orderId, amount, code: outcome.kind === 'cancelled' ? 'PAYMENT_CANCELLED' : 'PAYMENT_FAILED', message: outcome.kind === 'failed' ? outcome.message : null } })
}

export const useCheckout = (): CheckoutPage => {
  const { client, mode, locale } = useStorefront()
  const { store: carts, snapshot, cart } = useCartState()
  const { store, state } = useCheckoutState()
  const options = useShopData(snapshot.status === 'ready' && cart ? 'paymentOptions' : null, (c) => c.query(optionsQuery, optionsSchema))
  const payments = useMemo(() => (options.data?.paymentOptions ?? []).map((o): PaymentChoice => ({ provider: o.provider, kind: o.kind, instructions: o.instructions ?? null, test: o.mode === 'test' })), [options.data])
  const countries = useMemo(() => [...new Set((options.data?.store?.markets ?? []).flatMap((m) => m.countries ?? []))], [options.data])
  const steps = stepsOf(cart, state)
  const open = steps.find((s) => s.state === 'open')?.id ?? 'review'

  const send = async (operation: string, variables: Record<string, unknown>): Promise<boolean> => {
    store.set({ busy: true, error: null, problems: [] })
    const answer = await carts.change(operation, variables, changeSchema)
    store.set({ busy: false, error: carts.get().error, editing: answer ? null : store.get().editing })
    return answer !== null
  }

  // Apply the sole delivery option for the shopper (like a single payment option), so the delivery step is skipped.
  // Re-applies after an address edit clears it: cart changes run one at a time (cart.ts `inTurn`), so that edit lands
  // after this send settles. The in-flight guard and the narrow deps keep a failed send from looping.
  const soleOption = cart?.needsShipping && cart.shippingOptions.length === 1 ? (cart.shippingOptions[0]?.id ?? null) : null
  const applyingDelivery = useRef(false)
  useEffect(() => {
    if (soleOption === null || (cart?.shippingOption ?? null) !== null || applyingDelivery.current) return
    applyingDelivery.current = true
    void send(deliveryMutation, { option: soleOption }).finally(() => {
      applyingDelivery.current = false
    })
    // Deps are only the option and whether one is chosen: `send` and `cart` are new each render, so depending on them would re-send every render.
  }, [soleOption, cart?.shippingOption])

  const settle = async (orderId: string) => {
    store.set({ phase: { kind: 'confirming', orderId } })
    await client.request(confirmMutation, { orderId }).catch(() => undefined)
    navigate(orderPath(orderId))
  }

  const pay = (orderId: string, amount: Money, start: PaymentStart, provider: string) =>
    takePayment({ store, mode, locale, test: payments.find((p) => p.provider === provider)?.test ?? mode !== 'live', contact: { email: cart?.email ?? null, phone: cart?.phone ?? null, name: cart?.shippingAddress?.name ?? null }, paid: settle }, orderId, amount, start, provider)

  return {
    status: snapshot.status === 'error' ? 'error' : snapshot.status === 'loading' ? 'loading' : !cart || cart.lines.length === 0 ? 'empty' : 'ready',
    code: snapshot.code,
    retry: () => void carts.reload(),
    cart,
    steps,
    open,
    edit: (id) => store.set({ editing: id, error: null }),
    busy: state.busy,
    error: state.error,
    problems: state.problems,
    saveContact: async ({ email, phone }) => {
      const errors: Partial<Record<'email' | 'phone', FieldProblem>> = {}
      if (!email.trim()) errors.email = 'required'
      else if (!emailPattern.test(email.trim())) errors.email = 'invalid'
      if (phone.trim() && !isPhone(phone)) errors.phone = 'invalid'
      if (Object.keys(errors).length === 0) await send(contactMutation, { email: email.trim(), phone: compact(phone) || null })
      return errors
    },
    countries,
    saveAddress: async (a) => {
      const errors = addressProblems(a)
      if (Object.keys(errors).length === 0) await send(addressMutation, { address: addressInput(a) })
      return errors
    },
    chooseDelivery: (option) => send(deliveryMutation, { option }),
    payments,
    chosen: state.chosen ?? (payments.length === 1 ? (payments[0]?.provider ?? null) : null),
    choosePayment: (provider) => store.set({ chosen: provider, instructions: payments.find((p) => p.provider === provider)?.instructions ?? null }),
    review: async () => {
      const provider = store.get().chosen ?? (payments.length === 1 ? (payments[0]?.provider ?? null) : null)
      if (!provider) return false
      store.set({ chosen: provider, busy: true, error: null, problems: [] })
      try {
        const answer = await client.query(checkoutMutation, z.object({ checkout: cartSchema.nullable() }))
        await carts.reload()
        store.set({ busy: false, editing: answer.checkout?.readyToPay === false ? store.get().editing : null })
        return true
      } catch (error) {
        store.set({ busy: false, error: codeOf(error) })
        await carts.reload()
        return false
      }
    },
    place: async () => {
      const { chosen: provider, phase } = store.get()
      // One order per cart: while one is being placed or paid, or failed with its order, only payAgain goes on.
      if (mode === 'studio' || !provider || (phase.kind !== 'idle' && !(phase.kind === 'failed' && phase.orderId === null))) return
      store.set({ phase: { kind: 'placing' }, error: null })
      let placed: z.infer<typeof placeSchema>['placeOrder']
      try {
        placed = (await client.query(placeMutation, placeSchema, { provider })).placeOrder
      } catch (error) {
        store.set({ phase: { kind: 'failed', orderId: null, amount: null, code: codeOf(error), message: null } })
        return void carts.reload()
      }
      if (!placed.payment) return navigate(orderPath(placed.orderId))
      await pay(placed.orderId, placed.total, placed.payment, provider)
    },
    payAgain: async () => {
      const { phase, chosen } = store.get()
      if (phase.kind !== 'failed' || !phase.orderId || !phase.amount || !chosen) return
      const { orderId, amount } = phase
      store.set({ phase: { kind: 'placing' } })
      try {
        const start = (await client.query(payMutation, z.object({ payOrder: startSchema }), { orderId })).payOrder
        await pay(orderId, amount, start, chosen)
      } catch (error) {
        store.set({ phase: { kind: 'failed', orderId, amount, code: codeOf(error), message: null } })
      }
    },
    phase: state.phase,
    test: payments.some((p) => p.test) || mode !== 'live',
    mode,
  }
}

/**
 * "Try paying again" on the order's page (#313): a new attempt for a placed order whose card payment didn't go through,
 * in the sealed payment element the page places; `paid` reads the order again once it did, or once it was paid meanwhile.
 */
export const useRepay = (order: { id: string; total: Money; method: string } | null, paid: () => void): { again: (() => Promise<void>) | null; phase: PayPhase } => {
  const { client, mode, locale } = useStorefront()
  const { store, state } = useCheckoutState()
  const done = async (orderId: string) => {
    store.set({ phase: { kind: 'confirming', orderId } })
    await client.request(confirmMutation, { orderId }).catch(() => undefined)
    store.set({ phase: { kind: 'idle' } })
    paid()
  }
  const again = async () => {
    const { phase } = store.get()
    if (!order || (phase.kind !== 'idle' && phase.kind !== 'failed')) return
    store.set({ phase: { kind: 'placing' }, chosen: order.method, instructions: null })
    try {
      const start = (await client.query(payMutation, z.object({ payOrder: startSchema }), { orderId: order.id })).payOrder
      await takePayment({ store, mode, locale, test: mode !== 'live', contact: { email: null, phone: null, name: null }, paid: done }, order.id, order.total, start, order.method)
    } catch (error) {
      if (codeOf(error) === 'ALREADY_PAID') return done(order.id)
      store.set({ phase: { kind: 'failed', orderId: order.id, amount: order.total, code: codeOf(error), message: null } })
    }
  }
  return { again: order && mode !== 'studio' ? again : null, phase: state.phase }
}
