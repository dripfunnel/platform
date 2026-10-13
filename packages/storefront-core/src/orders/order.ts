'use client'

import { z } from 'zod'
import { useLocation } from '../platform/browser/router'
import { useShopData } from '../platform/render/data'
import { useHead } from '../platform/seo/head'
import { useStorefront } from '../platform/store/context'
import { moneySchema, type Money } from '../pricing/money'
import { moneyFields } from '../products/summary'
import { itemSlug } from '../collections/collections'
import { useRepay, type PayPhase } from '../checkout/checkout'

// A shopper's placed order (storefront ARCHITECTURE §2.1 `orders`): the page `/order/{id}/` a shopper lands on after paying or
// coming back from a provider. Reading it asks the provider about a card payment still pending (Shop API `confirmPayment`).

const m = `{ ${moneyFields} }`
const orderFields = `id number state paymentState paymentMethod paymentDueBy shippingMethod placedAt pricesIncludeTax lines { name versionName quantity unitPrice ${m} lineTotal ${m} } subtotal ${m} discounts { name amount ${m} } shipping ${m} tax ${m} total ${m}`
const confirmMutation = `mutation Order($orderId: ID!) { confirmPayment(orderId: $orderId) { ${orderFields} } }`
const instructionsQuery = `query Instructions { paymentOptions { provider instructions } }`

const text = z.string().nullable().optional()
const money = moneySchema.nullable().optional().catch(null)
const orderSchema = z.object({
  id: z.string(),
  number: text,
  state: text,
  paymentState: text,
  paymentMethod: text,
  paymentDueBy: text,
  shippingMethod: text,
  placedAt: text,
  pricesIncludeTax: z.boolean().nullable().optional(),
  lines: z.array(z.object({ name: text, versionName: text, quantity: z.number().int(), unitPrice: money, lineTotal: money })).nullable().optional(),
  subtotal: moneySchema,
  discounts: z.array(z.object({ name: text, amount: money })).nullable().optional(),
  shipping: money,
  tax: money,
  total: moneySchema,
})
const optionsSchema = z.object({ paymentOptions: z.array(z.object({ provider: z.string(), instructions: text })).nullable() })

/** Paid and settled; waiting for the shopper (a bank transfer, cash on delivery) or the provider (a card being confirmed); refunded. */
export type OrderPayment = 'paid' | 'awaiting' | 'confirming' | 'refunded'

export type OrderLine = { name: string; versionName: string | null; quantity: number; unitPrice: Money | null; lineTotal: Money | null }

export type Order = {
  id: string
  number: string
  cancelled: boolean
  payment: OrderPayment
  /** The way it is paid, as the engine names it: stripe, razorpay, cod, bank_transfer, … */
  method: string | null
  /** A bank transfer's details, as the store wrote them. */
  instructions: string | null
  /** When an unpaid bank transfer is cancelled, in the store's time zone and the shopper's words (themes have no `Intl`). */
  payBy: string | null
  delivery: string | null
  placedAt: string | null
  lines: OrderLine[]
  subtotal: Money
  discounts: { name: string; amount: Money }[]
  shipping: Money | null
  tax: { amount: Money; includesTax: boolean } | null
  total: Money
}

export type OrderPage = {
  status: 'loading' | 'ready' | 'missing' | 'error'
  code: string | null
  order: Order | null
  /** Asks again: "Try again" after a failure, "Check again" while a card payment is being confirmed. */
  retry: () => void
  /** "Try paying again" while a card payment hasn't gone through (declined, or left at the provider); null otherwise. */
  payAgain: (() => void) | null
  /** Where that new attempt stands, as the sealed payment element shows it. */
  paying: PayPhase
}

const manual = new Set(['cod', 'bank_transfer'])

const paymentOf = (o: z.infer<typeof orderSchema>): OrderPayment =>
  o.paymentState === 'paid' || o.paymentState === 'authorised' ? 'paid' : o.paymentState === 'refunded' || o.paymentState === 'partly_refunded' ? 'refunded' : o.paymentMethod && manual.has(o.paymentMethod) ? 'awaiting' : 'confirming'

const decode = (o: z.infer<typeof orderSchema>, instructions: string | null, when: (iso: string) => string): Order => ({
  id: o.id,
  number: o.number ?? o.id,
  cancelled: o.state === 'cancelled',
  payment: paymentOf(o),
  method: o.paymentMethod ?? null,
  instructions,
  payBy: o.paymentDueBy ? when(o.paymentDueBy) : null,
  delivery: o.shippingMethod ?? null,
  placedAt: o.placedAt ?? null,
  lines: (o.lines ?? []).map((l) => ({ name: l.name ?? '', versionName: l.versionName ?? null, quantity: l.quantity, unitPrice: l.unitPrice ?? null, lineTotal: l.lineTotal ?? null })),
  subtotal: o.subtotal,
  discounts: (o.discounts ?? []).flatMap((d) => (d.amount ? [{ name: d.name ?? '', amount: d.amount }] : [])),
  shipping: o.shipping ?? null,
  tax: o.tax ? { amount: o.tax, includesTax: o.pricesIncludeTax === true } : null,
  total: o.total,
})

/** The order the address names (`/order/{id}/`); a guest reads it with the cart it was placed from, a customer with their session. */
export const useOrder = (): OrderPage => {
  const { t, store, locale } = useStorefront()
  const { path } = useLocation()
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: store.timeZone, timeZoneName: 'short' }).format(new Date(iso))
  const id = itemSlug(path, '/order/')
  const loaded = useShopData(id ? JSON.stringify(['order', id]) : null, async (client) => {
    const found = (await client.query(confirmMutation, z.object({ confirmPayment: orderSchema.nullable() }), { orderId: id })).confirmPayment
    if (!found) return null
    const awaitingTransfer = found.paymentMethod === 'bank_transfer' && paymentOf(found) === 'awaiting'
    const options = awaitingTransfer ? await client.query(instructionsQuery, optionsSchema).catch(() => null) : null
    return decode(found, options?.paymentOptions?.find((p) => p.provider === 'bank_transfer')?.instructions ?? null, when)
  })
  const status = id === null || (loaded.status === 'ready' && !loaded.data) ? 'missing' : loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading'
  useHead({ title: loaded.data ? t('order.title', { number: loaded.data.number }) : null, hidden: true })
  const order = loaded.data ?? null
  const unpaidCard = order && !order.cancelled && order.payment === 'confirming' && order.method && !manual.has(order.method) ? { id: order.id, total: order.total, method: order.method } : null
  const repay = useRepay(unpaidCard, loaded.retry)
  const idle = repay.phase.kind === 'idle' || repay.phase.kind === 'failed'
  return { status, code: loaded.code, order, retry: loaded.retry, payAgain: repay.again && idle ? () => void repay.again?.() : null, paying: repay.phase }
}
