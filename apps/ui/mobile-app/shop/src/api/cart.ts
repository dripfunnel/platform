import { z } from 'zod'
import { ApiError, decode, isApiError, type ApiClient } from '@dripfunnel/mobile-shared/graphql'
import { addressInput, type AddressInput, type Pin } from './account'
import type { Price } from './catalogue'
import { operation, type Operation } from './operation'

// The cart and checkout of the Shop API (apps/api schema/shop.graphql). Every price, tax, delivery charge and refusal is the
// engine's: this file reads them and sends the shopper's choices, and computes nothing.

export type LineProblem = 'unavailable' | 'not_sold_here' | 'not_priced' | 'short'
export type CodeState = 'APPLIED' | 'NOT_ELIGIBLE' | 'DOESNT_COMBINE' | 'INVALID' | 'EXPIRED' | 'USED_UP' | 'ALREADY_USED' | 'SIGN_IN_REQUIRED'

export type CartLine = {
  versionId: string
  productSlug: string | null
  name: string
  versionName: string | null
  photoUrl: string | null
  quantity: number
  available: number | null
  unitPrice: Price | null
  lineTotal: Price | null
  problem: LineProblem | null
}

export type DeliveryOption = { id: string; service: string | null; amount: Price | null; minDays: number | null; maxDays: number | null; hours: string | null }

export type DeliveryAddress = { name: string; line1: string; line2: string; city: string; region: string; postalCode: string; country: string; phone: string; pin: Pin | null }

export type Cart = {
  email: string
  phone: string
  needsShipping: boolean
  currency: string
  lines: CartLine[]
  codes: { code: string; state: CodeState }[]
  discounts: { name: string; amount: Price | null }[]
  subtotal: Price | null
  discount: Price | null
  shipping: Price | null
  tax: { amount: Price | null; pricesIncludeTax: boolean } | null
  total: Price | null
  shippingAddress: DeliveryAddress | null
  shippingOption: string | null
  shippingOptions: DeliveryOption[]
  problems: string[]
  readyToPay: boolean
}

export type PaymentOption = { provider: string; kind: string; instructions: string | null }

/** What a provider's own sheet needs to take a payment, exactly as the Shop API answers it. */
export type PaymentStart = {
  providerRef: string | null
  /** Stripe: the publishable key of the merchant's connected account, and that account's id. */
  publicKey: string | null
  accountId: string | null
  clientSecret: string | null
  /** Stripe, for a signed-in shopper only: their saved cards. */
  customerId: string | null
  ephemeralKeySecret: string | null
  /** PayPal: the approval page. */
  redirectUrl: string | null
  /** `test` or `live`, the storefront's. */
  mode: string | null
}

/** What the API needs of the app to start a payment in its own sheet: the app's URL scheme, and for Stripe the API version its SDK speaks. */
export type AppPayment = { scheme: string; stripeApiVersion?: string }

export type PlacedOrder = { orderId: string; number: string; total: Price | null; provider: string; instructions: string | null; payment: PaymentStart | null }

const text = z.string().nullable().optional()
const money = z.object({ amount: z.string(), currency: z.string() }).nullable().optional()
const priceOf = (value: z.infer<typeof money>): Price | null => value ?? null

const moneyFields = '{ amount currency }'
const cartFields = `email phone needsShipping currency checkoutStep readyToPay problems
  subtotal ${moneyFields} discount ${moneyFields} shipping ${moneyFields} total ${moneyFields} tax { amount ${moneyFields} pricesIncludeTax }
  codes { code state } discounts { name amount ${moneyFields} }
  lines { versionId productSlug productName versionName photoUrl quantity available unitPrice ${moneyFields} lineTotal ${moneyFields} problem }
  shippingAddress { name line1 line2 city region postalCode country phone latitude longitude }
  shippingOption shippingOptions { id service amount ${moneyFields} minDays maxDays hours }`

const cartSchema = z.object({
  email: text,
  phone: text,
  needsShipping: z.boolean().nullable().optional(),
  currency: text,
  readyToPay: z.boolean().nullable().optional(),
  problems: z.array(z.string()).nullable().optional(),
  subtotal: money,
  discount: money,
  shipping: money,
  total: money,
  tax: z.object({ amount: money, pricesIncludeTax: z.boolean().nullable().optional() }).nullable().optional(),
  codes: z.array(z.object({ code: text, state: text })).nullable().optional(),
  discounts: z.array(z.object({ name: text, amount: money })).nullable().optional(),
  lines: z
    .array(
      z.object({
        versionId: z.string().nullable().optional(),
        productSlug: text,
        productName: text,
        versionName: text,
        photoUrl: text,
        quantity: z.number().nullable().optional(),
        available: z.number().nullable().optional(),
        unitPrice: money,
        lineTotal: money,
        problem: text,
      }),
    )
    .nullable()
    .optional(),
  shippingAddress: z.object({ name: text, line1: text, line2: text, city: text, region: text, postalCode: text, country: text, phone: text, latitude: z.number().nullable().optional(), longitude: z.number().nullable().optional() }).nullable().optional(),
  shippingOption: text,
  shippingOptions: z.array(z.object({ id: text, service: text, amount: money, minDays: z.number().nullable().optional(), maxDays: z.number().nullable().optional(), hours: text })).nullable().optional(),
})

const lineProblems: readonly string[] = ['unavailable', 'not_sold_here', 'not_priced', 'short']
const codeStates: readonly string[] = ['APPLIED', 'NOT_ELIGIBLE', 'DOESNT_COMBINE', 'INVALID', 'EXPIRED', 'USED_UP', 'ALREADY_USED', 'SIGN_IN_REQUIRED']

const cartOf = (raw: z.infer<typeof cartSchema>): Cart => ({
  email: raw.email ?? '',
  phone: raw.phone ?? '',
  needsShipping: raw.needsShipping === true,
  currency: raw.currency ?? '',
  readyToPay: raw.readyToPay === true,
  problems: raw.problems ?? [],
  subtotal: priceOf(raw.subtotal),
  discount: priceOf(raw.discount),
  shipping: priceOf(raw.shipping),
  total: priceOf(raw.total),
  tax: raw.tax ? { amount: priceOf(raw.tax.amount), pricesIncludeTax: raw.tax.pricesIncludeTax === true } : null,
  codes: (raw.codes ?? []).flatMap((c) => (c.code && c.state && codeStates.includes(c.state) ? [{ code: c.code, state: c.state as CodeState }] : [])),
  discounts: (raw.discounts ?? []).map((d) => ({ name: d.name ?? '', amount: priceOf(d.amount) })),
  lines: (raw.lines ?? []).flatMap((l) =>
    l.versionId
      ? [
          {
            versionId: l.versionId,
            productSlug: l.productSlug ?? null,
            name: l.productName ?? '',
            versionName: l.versionName ?? null,
            photoUrl: l.photoUrl ?? null,
            quantity: l.quantity ?? 0,
            available: l.available ?? null,
            unitPrice: priceOf(l.unitPrice),
            lineTotal: priceOf(l.lineTotal),
            problem: l.problem && lineProblems.includes(l.problem) ? (l.problem as LineProblem) : null,
          },
        ]
      : [],
  ),
  shippingAddress: raw.shippingAddress
    ? {
        name: raw.shippingAddress.name ?? '',
        line1: raw.shippingAddress.line1 ?? '',
        line2: raw.shippingAddress.line2 ?? '',
        city: raw.shippingAddress.city ?? '',
        region: raw.shippingAddress.region ?? '',
        postalCode: raw.shippingAddress.postalCode ?? '',
        country: raw.shippingAddress.country ?? '',
        phone: raw.shippingAddress.phone ?? '',
        pin: typeof raw.shippingAddress.latitude === 'number' && typeof raw.shippingAddress.longitude === 'number' ? { latitude: raw.shippingAddress.latitude, longitude: raw.shippingAddress.longitude } : null,
      }
    : null,
  shippingOption: raw.shippingOption ?? null,
  shippingOptions: (raw.shippingOptions ?? []).flatMap((o) => (o.id ? [{ id: o.id, service: o.service ?? null, amount: priceOf(o.amount), minDays: o.minDays ?? null, maxDays: o.maxDays ?? null, hours: o.hours ?? null }] : [])),
})

/** The shopper's open cart, or null when there is none. Never kept on the phone: it holds their contact details. */
export const cartOperation = (): Operation<Cart | null> =>
  operation(null, `{ cart { ${cartFields} } }`, {}, (data) => {
    const { cart } = decode(z.object({ cart: cartSchema.nullable() }), data)
    return cart ? cartOf(cart) : null
  })

/** The ways the store takes payment, in the order the API gives them. */
export const paymentOptionsOperation = (): Operation<PaymentOption[]> =>
  operation(null, '{ paymentOptions { provider kind instructions } }', {}, (data) => {
    const { paymentOptions } = decode(z.object({ paymentOptions: z.array(z.object({ provider: z.string(), kind: text, instructions: text })).nullable() }), data)
    return (paymentOptions ?? []).map((o) => ({ provider: o.provider, kind: o.kind ?? '', instructions: o.instructions ?? null }))
  })

/** A cart change answers the whole cart, and a new guest cart's token. */
export type CartChange = { cart: Cart | null; cartToken: string | null }

const changeSchema = (field: string) => z.object({ [field]: z.object({ cart: cartSchema.nullable(), cartToken: text }).nullable() })

const change = async (client: ApiClient, field: string, signature: string, variables: Record<string, unknown>): Promise<CartChange> => {
  const answer = decode(changeSchema(field), await client.request<unknown>(`mutation${signature} { ${field}(${Object.keys(variables).map((k) => `${k}: $${k}`).join(', ')}) { cart { ${cartFields} } cartToken } }`, variables))[field]
  return { cart: answer?.cart ? cartOf(answer.cart) : null, cartToken: answer?.cartToken ?? null }
}

/** A quantity of 0 takes the line out. */
export const setQuantity = (client: ApiClient, versionId: string, quantity: number) => change(client, 'setCartQuantity', '($versionId: ID!, $quantity: Int!)', { versionId, quantity })

export const removeCode = (client: ApiClient, code: string) => change(client, 'removeCode', '($code: String!)', { code })

export const setContact = (client: ApiClient, contact: { email: string; phone: string | null }) => change(client, 'setCartContact', '($email: String, $phone: String)', contact)

/** The address goes with its pin: own delivery decides by it (api/DELIVERY.md §2). */
export const setShippingAddress = (client: ApiClient, address: AddressInput) => change(client, 'setShippingAddress', '($address: ShopAddressInput!)', { address: addressInput(address) })

export const setShippingOption = (client: ApiClient, option: string) => change(client, 'setShippingOption', '($option: String!)', { option })

/** What a code did: its state, and the cart priced with it. A code that can't work comes straight back off. */
export const applyCode = async (client: ApiClient, code: string): Promise<{ state: CodeState; cart: Cart | null }> => {
  const { applyCode: answer } = decode(
    z.object({ applyCode: z.object({ state: z.string(), cart: cartSchema.nullable() }).nullable() }),
    await client.request<unknown>(`mutation($code: String!) { applyCode(code: $code) { state cart { ${cartFields} } } }`, { code }),
  )
  const state = answer && codeStates.includes(answer.state) ? (answer.state as CodeState) : 'INVALID'
  return { state, cart: answer?.cart ? cartOf(answer.cart) : null }
}

/** "Continue to payment": the cart ready to pay, or a NOT_READY refusal whose `problems` say what is missing. */
export const continueToPayment = async (client: ApiClient): Promise<Cart | null> => {
  const { checkout } = decode(z.object({ checkout: cartSchema.nullable() }), await client.request<unknown>(`mutation { checkout { ${cartFields} } }`))
  return checkout ? cartOf(checkout) : null
}

const paymentFields = 'providerRef publicKey accountId clientSecret customerId ephemeralKeySecret redirectUrl mode'

const paymentSchema = z
  .object({ providerRef: text, publicKey: text, accountId: text, clientSecret: text, customerId: text, ephemeralKeySecret: text, redirectUrl: text, mode: text })
  .nullable()
  .optional()

const paymentOf = (raw: z.infer<typeof paymentSchema>): PaymentStart | null =>
  raw
    ? {
        providerRef: raw.providerRef ?? null,
        publicKey: raw.publicKey ?? null,
        accountId: raw.accountId ?? null,
        clientSecret: raw.clientSecret ?? null,
        customerId: raw.customerId ?? null,
        ephemeralKeySecret: raw.ephemeralKeySecret ?? null,
        redirectUrl: raw.redirectUrl ?? null,
        mode: raw.mode ?? null,
      }
    : null

/** Places the order; a card or wallet provider also answers what its sheet needs, and the order stays unpaid until the provider's webhook says so. */
export const placeOrder = async (client: ApiClient, provider: string, app?: AppPayment): Promise<PlacedOrder> => {
  const { placeOrder: placed } = decode(
    z.object({ placeOrder: z.object({ orderId: z.string(), number: z.string(), total: money, provider: z.string(), instructions: text, payment: paymentSchema }) }),
    await client.request<unknown>(
      `mutation($provider: String!, $app: ShopAppPaymentInput) { placeOrder(provider: $provider, app: $app) { orderId number total { amount currency } provider instructions payment { ${paymentFields} } } }`,
      app ? { provider, app } : { provider },
    ),
  )
  return { orderId: placed.orderId, number: placed.number, total: priceOf(placed.total), provider: placed.provider, instructions: placed.instructions ?? null, payment: paymentOf(placed.payment) }
}

/** "Try again" after a sheet was cancelled or the payment declined: a new attempt for the same order and way to pay, never a second order. */
export const payOrder = async (client: ApiClient, orderId: string, app: AppPayment): Promise<PaymentStart> => {
  const { payOrder: start } = decode(
    z.object({ payOrder: paymentSchema }),
    await client.request<unknown>(`mutation($orderId: ID!, $app: ShopAppPaymentInput) { payOrder(orderId: $orderId, app: $app) { ${paymentFields} } }`, { orderId, app }),
  )
  const started = paymentOf(start)
  if (!started) throw new ApiError('BAD_RESPONSE', 'The API returned no payment to start.')
  return started
}

/** Where an order's payment stands, read back from the provider on the shopper's return (the website's `confirmPayment`); the app never marks an order paid. */
export type PaymentRead = { cancelled: boolean; paid: boolean }

export const readPayment = async (client: ApiClient, orderId: string): Promise<PaymentRead | null> => {
  const { confirmPayment } = decode(
    z.object({ confirmPayment: z.object({ state: text, paymentState: text }).nullable() }),
    await client.request<unknown>('mutation($orderId: ID!) { confirmPayment(orderId: $orderId) { state paymentState } }', { orderId }),
  )
  return confirmPayment ? { cancelled: confirmPayment.state === 'cancelled', paid: confirmPayment.paymentState === 'paid' } : null
}

/** The checkout problems a refusal names (`NO_CONTACT`, `NO_ADDRESS`, ...), unchecked data from the API. */
export const problemsOf = (error: unknown): string[] => {
  if (!isApiError(error)) return []
  const problems = error.details['problems']
  return Array.isArray(problems) ? problems.filter((p): p is string => typeof p === 'string') : []
}
