'use client'

import { useEffect, useMemo, useState } from 'react'
import { z } from 'zod'
import { keepShopperToken, shopperToken } from '../platform/api/tokens'
import { useLocation } from '../platform/browser/router'
import { useShopData } from '../platform/render/data'
import { useHead } from '../platform/seo/head'
import { useStorefront } from '../platform/store/context'
import { isZero, moneySchema, type Money } from '../pricing/money'
import { moneyFields } from '../products/summary'
import { itemSlug } from '../collections/collections'
import { useRepay, type PayPhase } from '../checkout/checkout'

// A shopper's placed order (storefront ARCHITECTURE §2.1 `orders`): the page `/order/{id}/` a shopper lands on after paying or
// coming back from a provider. Reading it asks the provider about a card payment still pending (Shop API `confirmPayment`).

const m = `{ ${moneyFields} }`
const orderFields = `id number state paymentState paymentMethod paymentDueBy shippingMethod placedAt pricesIncludeTax lines { name versionName quantity unitPrice ${m} lineTotal ${m} gift { recipientName sendOn } } subtotal ${m} discounts { name amount ${m} } shipping ${m} giftCard ${m} tax ${m} total ${m} downloads { name url usesLeft expiresAt } licenceKeys { name key }`
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
  lines: z.array(z.object({ name: text, versionName: text, quantity: z.number().int(), unitPrice: money, lineTotal: money, gift: z.object({ recipientName: text, recipientEmail: text, sendOn: text }).nullable().optional() })).nullable().optional(),
  subtotal: moneySchema,
  discounts: z.array(z.object({ name: text, amount: money })).nullable().optional(),
  shipping: money,
  giftCard: money,
  tax: money,
  total: moneySchema,
  downloads: z.array(z.object({ name: text, url: text, usesLeft: z.number().int().nullable().optional(), expiresAt: text })).nullable().optional(),
  licenceKeys: z.array(z.object({ name: text, key: text })).nullable().optional(),
})
const optionsSchema = z.object({ paymentOptions: z.array(z.object({ provider: z.string(), instructions: text })).nullable() })

/** Paid and settled; waiting for the shopper (a bank transfer, cash on delivery) or the provider (a card being confirmed); refunded. */
export type OrderPayment = 'paid' | 'awaiting' | 'confirming' | 'refunded'

export type OrderLine = { name: string; versionName: string | null; quantity: number; unitPrice: Money | null; lineTotal: Money | null; gift: { recipientName: string; sendOn: string | null } | null }

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
  /** What a gift card paid of the total. */
  giftCard: Money | null
  /** Each download, once paid: its link (signed, for this shopper), how many uses are left and until when, worded. */
  downloads: { name: string; url: string | null; usesLeft: number | null; until: string | null }[]
  /** Each licence key, once paid. */
  licenceKeys: { name: string; key: string }[]
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

const paymentOf = (o: Pick<z.infer<typeof orderSchema>, 'paymentState' | 'paymentMethod'>): OrderPayment =>
  o.paymentState === 'paid' || o.paymentState === 'authorised' ? 'paid' : o.paymentState === 'refunded' || o.paymentState === 'partly_refunded' ? 'refunded' : o.paymentMethod && manual.has(o.paymentMethod) ? 'awaiting' : 'confirming'

const decode = (o: z.infer<typeof orderSchema>, instructions: string | null, when: (iso: string) => string, day: (date: string) => string): Order => ({
  id: o.id,
  number: o.number ?? o.id,
  cancelled: o.state === 'cancelled',
  payment: paymentOf(o),
  method: o.paymentMethod ?? null,
  instructions,
  payBy: o.paymentDueBy ? when(o.paymentDueBy) : null,
  delivery: o.shippingMethod ?? null,
  placedAt: o.placedAt ?? null,
  lines: (o.lines ?? []).map((l) => ({ name: l.name ?? '', versionName: l.versionName ?? null, quantity: l.quantity, unitPrice: l.unitPrice ?? null, lineTotal: l.lineTotal ?? null, gift: l.gift?.recipientName ? { recipientName: l.gift.recipientName, sendOn: l.gift.sendOn ? day(l.gift.sendOn) : null } : null })),
  subtotal: o.subtotal,
  discounts: (o.discounts ?? []).flatMap((d) => (d.amount ? [{ name: d.name ?? '', amount: d.amount }] : [])),
  shipping: o.shipping ?? null,
  tax: o.tax ? { amount: o.tax, includesTax: o.pricesIncludeTax === true } : null,
  total: o.total,
  giftCard: o.giftCard && !isZero(o.giftCard) ? o.giftCard : null,
  downloads: (o.downloads ?? []).map((d) => ({ name: d.name ?? '', url: d.url ?? null, usesLeft: d.usesLeft ?? null, until: d.expiresAt ? when(d.expiresAt) : null })),
  licenceKeys: (o.licenceKeys ?? []).flatMap((k) => (k.key ? [{ name: k.name ?? '', key: k.key }] : [])),
})

export const ordersPageSize = 20
const listQuery = `query OrderHistory($first: Int, $after: String) { orderHistory(first: $first, after: $after) { nodes { id number state paymentState paymentMethod placedAt pricesIncludeTax itemCount total ${m} } pageInfo { hasNextPage endCursor } } }`
const rowSchema = z.object({ id: z.string(), number: text, state: text, paymentState: text, paymentMethod: text, placedAt: text, pricesIncludeTax: z.boolean().nullable().optional(), itemCount: z.number().int().nullable().optional(), total: moneySchema })
const listSchema = z.object({ orderHistory: z.object({ nodes: z.array(rowSchema).nullable().optional(), pageInfo: z.object({ hasNextPage: z.boolean().nullable().optional(), endCursor: text }).nullable().optional() }).nullable() })

/** One order in the account's list: open it at `/account/orders/{id}/`. */
export type OrderRow = {
  id: string
  number: string
  /** The day it was placed, in the store's time zone and the shopper's words. */
  placedOn: string | null
  /** Items, every quantity counted. */
  items: number
  cancelled: boolean
  payment: OrderPayment
  method: string | null
  total: Money
  includesTax: boolean
}

export type OrdersPage = {
  /** `signedOut` when there's no session, or it ended (and always on a preview); the theme sends the shopper to sign in. */
  status: 'loading' | 'ready' | 'signedOut' | 'error'
  code: string | null
  orders: OrderRow[]
  /** Signed in, with no orders yet. */
  empty: boolean
  more: boolean
  /** The next 20 older orders, added below. */
  loadMore: () => Promise<void>
  loadingMore: boolean
  /** The last `loadMore` failed; asking again is the way on. */
  loadMoreFailed: boolean
  retry: () => void
}

/** The signed-in shopper's own orders, newest first, a page at a time; never asked for on a preview, where nobody signs in. */
export const useOrders = (): OrdersPage => {
  const { client, mode, store, locale, t } = useStorefront()
  const signedIn = mode === 'live' && shopperToken('session') !== undefined
  const loaded = useShopData(signedIn ? 'orderHistory' : null, (c) => c.query(listQuery, listSchema, { first: ordersPageSize, after: null }))
  const [later, setLater] = useState<{ rows: z.infer<typeof rowSchema>[]; cursor: string | null; more: boolean } | null>(null)
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadMoreFailed, setLoadMoreFailed] = useState(false)
  const day = useMemo(() => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: store.timeZone }), [locale, store.timeZone])
  const first = loaded.data?.orderHistory
  const cursor = later ? later.cursor : (first?.pageInfo?.endCursor ?? null)
  const more = later ? later.more : first?.pageInfo?.hasNextPage === true
  const orders = useMemo(
    () =>
      [...(first?.nodes ?? []), ...(later?.rows ?? [])].map((o): OrderRow => {
        const placed = o.placedAt ? new Date(o.placedAt) : null
        return {
          id: o.id,
          number: o.number ?? o.id,
          placedOn: placed && !Number.isNaN(placed.getTime()) ? day.format(placed) : null,
          items: o.itemCount ?? 0,
          cancelled: o.state === 'cancelled',
          payment: paymentOf(o),
          method: o.paymentMethod ?? null,
          total: o.total,
          includesTax: o.pricesIncludeTax === true,
        }
      }),
    [first, later, day],
  )
  useHead({ title: t('orders.title'), hidden: true })
  const signedOut = !signedIn || loaded.code === 'SIGNED_OUT'
  // The session ended while it was kept: forget it, as the account does, so signing in starts afresh.
  useEffect(() => {
    if (signedIn && loaded.code === 'SIGNED_OUT') keepShopperToken('session', null)
  }, [signedIn, loaded.code])
  const status = signedOut ? 'signedOut' : loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading'
  return {
    status,
    code: loaded.code,
    orders,
    empty: status === 'ready' && orders.length === 0,
    more,
    loadingMore,
    loadMoreFailed,
    loadMore: async () => {
      if (!more || loadingMore || !cursor) return
      setLoadingMore(true)
      setLoadMoreFailed(false)
      try {
        const next = (await client.query(listQuery, listSchema, { first: ordersPageSize, after: cursor })).orderHistory
        setLater({ rows: [...(later?.rows ?? []), ...(next?.nodes ?? [])], cursor: next?.pageInfo?.endCursor ?? null, more: next?.pageInfo?.hasNextPage === true })
      } catch {
        setLoadMoreFailed(true)
      } finally {
        setLoadingMore(false)
      }
    },
    retry: () => {
      setLater(null)
      loaded.retry()
    },
  }
}

/** The order the address names (`/order/{id}/`, or `/account/orders/{id}/` in the account); a guest reads it with the cart it was placed from, a customer with their session. */
export const useOrder = (): OrderPage => {
  const { t, store, locale } = useStorefront()
  const { path } = useLocation()
  const when = (iso: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit', timeZone: store.timeZone, timeZoneName: 'short' }).format(new Date(iso))
  // A gift's send-on day is a calendar date, not a moment: shown as that date, with no time and no shift of zone.
  const day = (date: string) => new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${date.slice(0, 10)}T12:00:00Z`))
  const id = itemSlug(path, '/order/') ?? itemSlug(path, '/account/orders/')
  const loaded = useShopData(id ? JSON.stringify(['order', id]) : null, async (client) => {
    const found = (await client.query(confirmMutation, z.object({ confirmPayment: orderSchema.nullable() }), { orderId: id })).confirmPayment
    if (!found) return null
    const awaitingTransfer = found.paymentMethod === 'bank_transfer' && paymentOf(found) === 'awaiting'
    const options = awaitingTransfer ? await client.query(instructionsQuery, optionsSchema).catch(() => null) : null
    return decode(found, options?.paymentOptions?.find((p) => p.provider === 'bank_transfer')?.instructions ?? null, when, day)
  })
  const status = id === null || (loaded.status === 'ready' && !loaded.data) ? 'missing' : loaded.status === 'ready' ? 'ready' : loaded.status === 'error' ? 'error' : 'loading'
  useHead({ title: loaded.data ? t('order.title', { number: loaded.data.number }) : null, hidden: true })
  const order = loaded.data ?? null
  const unpaidCard = order && !order.cancelled && order.payment === 'confirming' && order.method && !manual.has(order.method) ? { id: order.id, total: order.total, method: order.method } : null
  const repay = useRepay(unpaidCard, loaded.retry)
  const idle = repay.phase.kind === 'idle' || repay.phase.kind === 'failed'
  return { status, code: loaded.code, order, retry: loaded.retry, payAgain: repay.again && idle ? () => void repay.again?.() : null, paying: repay.phase }
}
