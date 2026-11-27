import { z } from 'zod'
import { PaymentRefused } from '#core/payments'
import { callProvider, hmacHex, sameText } from './http'

// Plan billing through Razorpay Subscriptions on the partner's own account (#1744; SAAS §7.4).

const apiBase = 'https://api.razorpay.com/v1'

export interface RazorpayKeys {
  keyId: string
  keySecret: string
  webhookSecret: string
}

const keyIdShape = /^rzp_(live|test)_[A-Za-z0-9]{6,40}$/
export const razorpayKeysSchema = z.strictObject({ keyId: z.string().trim().regex(keyIdShape), keySecret: z.string().trim().min(1).max(100), webhookSecret: z.string().trim().min(1).max(200) })

/** "rzp_live_••••AbCd": the mode and the last four, never the key. */
export const keyHintOf = (keyId: string) => `${keyId.slice(0, keyId.indexOf('_', 4) + 1)}••••${keyId.slice(-4)}`

const authOf = (keys: RazorpayKeys) => `Basic ${btoa(`${keys.keyId}:${keys.keySecret}`)}`
const idOf = (prefix: string) => z.string().regex(new RegExp(`^${prefix}_[A-Za-z0-9]+$`))

const subscriptionSchema = z
  .object({
    id: idOf('sub'),
    status: z.enum(['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed', 'expired', 'paused']),
    plan_id: idOf('plan'),
    customer_id: z.string().nullish(),
    current_start: z.number().int().nullish(),
    current_end: z.number().int().nullish(),
    start_at: z.number().int().nullish(),
    paid_count: z.number().int().nonnegative(),
    payment_method: z.string().nullish(),
    notes: z.record(z.string(), z.unknown()).or(z.array(z.unknown())).nullish(),
  })
  .loose()
export type RazorpaySubscription = z.infer<typeof subscriptionSchema>

const paymentSchema = z
  .object({
    id: idOf('pay'),
    status: z.string(),
    amount: z.number().int().nonnegative(),
    currency: z.string(),
    method: z.string().nullish(),
    vpa: z.string().nullish(),
    card: z.object({ last4: z.string().nullish(), network: z.string().nullish() }).loose().nullish(),
  })
  .loose()
export type RazorpayPayment = z.infer<typeof paymentSchema>

const invoiceSchema = z.object({ id: z.string(), status: z.string(), payment_id: z.string().nullish(), billing_start: z.number().int().nullish(), billing_end: z.number().int().nullish() }).loose()
export type RazorpayInvoice = z.infer<typeof invoiceSchema>

const eventSchema = z
  .object({
    payload: z
      .object({
        subscription: z.object({ entity: z.object({ id: z.string() }).loose() }).loose().optional(),
      })
      .loose(),
  })
  .loose()

/** What the saved method is, as a person reads it: a card's network and last four, or a masked UPI handle. */
export const methodOf = (p: RazorpayPayment): string | null => {
  if (p.method === 'upi' && p.vpa) {
    const [name = '', bank = ''] = p.vpa.split('@')
    return `UPI AutoPay · ${name.slice(0, 2)}••••@${bank}`
  }
  const last4 = p.card?.last4 && /^\d{4}$/.test(p.card.last4) ? p.card.last4 : null
  return last4 ? `${p.card?.network ?? 'Card'} ending ${last4}` : null
}

/** Razorpay's dates are seconds since the epoch. */
export const dateOf = (seconds: number | null | undefined): Date | null => (seconds ? new Date(seconds * 1000) : null)

export const razorpayBilling = ({ fetchImpl = fetch }: { fetchImpl?: typeof fetch } = {}) => {
  const call = <S extends z.ZodType>(keys: RazorpayKeys, method: 'GET' | 'POST' | 'PATCH', path: string, schema: S, body?: unknown) =>
    callProvider(fetchImpl, `${apiBase}${path}`, { method, headers: { authorization: authOf(keys), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }, schema)
  const subscriptionPath = (id: string) => {
    if (!/^sub_[A-Za-z0-9]+$/.test(id)) throw new PaymentRefused('not a subscription')
    return `/subscriptions/${id}`
  }

  return {
    /** One read with the keys before they are saved; throws PaymentRefused for keys Razorpay refuses. */
    verify: async (keys: RazorpayKeys): Promise<void> => {
      await call(keys, 'GET', '/plans?count=1', z.unknown())
    },

    /** A Razorpay plan for one partner plan, period and price; made once and kept (db/scoped/razorpayBilling). */
    createPlan: async (keys: RazorpayKeys, p: { name: string; amount: number; currency: string; interval: 'month' | 'year'; planId: string; planVersion: number }) =>
      (
        await call(keys, 'POST', '/plans', z.object({ id: idOf('plan') }).loose(), {
          period: p.interval === 'year' ? 'yearly' : 'monthly',
          interval: 1,
          item: { name: p.name.slice(0, 100), amount: p.amount, currency: p.currency },
          notes: { df_plan_id: p.planId, df_plan_version: String(p.planVersion) },
        })
      ).id,

    /** The store's subscription; Checkout opens on it, and its first payment both pays the plan and sets up the mandate. */
    createSubscription: async (keys: RazorpayKeys, s: { razorpayPlanId: string; interval: 'month' | 'year'; storeId: string; startAt?: Date | null; addon?: { name: string; amount: number; currency: string } | null }) =>
      call(keys, 'POST', '/subscriptions', subscriptionSchema, {
        plan_id: s.razorpayPlanId,
        // A plan change starts when the current period ends; anything due today is a one-time add-on paid at approval.
        ...(s.startAt ? { start_at: Math.floor(s.startAt.getTime() / 1000) } : {}),
        ...(s.addon ? { addons: [{ item: { name: s.addon.name.slice(0, 100), amount: s.addon.amount, currency: s.addon.currency } }] } : {}),
        // Ten years of renewals; the store cancels it (Close my store) long before that runs out.
        total_count: s.interval === 'year' ? 10 : 120,
        quantity: 1,
        customer_notify: 0,
        notes: { df_store_id: s.storeId },
      }),

    subscription: (keys: RazorpayKeys, id: string) => call(keys, 'GET', subscriptionPath(id), subscriptionSchema),

    /** Close my store: no renewal after the period it has paid for. */
    cancelAtCycleEnd: (keys: RazorpayKeys, id: string) => call(keys, 'POST', `${subscriptionPath(id)}/cancel`, subscriptionSchema, { cancel_at_cycle_end: 1 }),

    /** A subscription another one replaces before it charges again: ended now. */
    cancelNow: (keys: RazorpayKeys, id: string) => call(keys, 'POST', `${subscriptionPath(id)}/cancel`, subscriptionSchema, { cancel_at_cycle_end: 0 }),

    /** The subscription's invoices, newest first: each period Razorpay billed, and the payment that paid it. */
    invoices: async (keys: RazorpayKeys, id: string): Promise<RazorpayInvoice[]> => {
      subscriptionPath(id)
      return (await call(keys, 'GET', `/invoices?subscription_id=${id}&count=10`, z.object({ items: z.array(invoiceSchema) }).loose())).items
    },

    payment: (keys: RazorpayKeys, paymentId: string) => {
      if (!/^pay_[A-Za-z0-9]+$/.test(paymentId)) throw new PaymentRefused('not a payment')
      return call(keys, 'GET', `/payments/${paymentId}`, paymentSchema)
    },

    /** Checkout's answer for a subscription, signed with the key secret over "payment|subscription". */
    checkoutSignatureValid: async (keys: RazorpayKeys, paymentId: string, subscriptionId: string, signature: string) => sameText(await hmacHex(keys.keySecret, `${paymentId}|${subscriptionId}`), signature),

    /** A webhook signed with the partner's webhook secret; it only says which subscription to read back. */
    webhookSubscription: async (keys: RazorpayKeys, body: string, signature: string): Promise<{ valid: false } | { valid: true; subscriptionId: string | null }> => {
      if (!sameText(await hmacHex(keys.webhookSecret, body), signature)) return { valid: false }
      let json: unknown
      try {
        json = JSON.parse(body)
      } catch {
        return { valid: false }
      }
      const event = eventSchema.safeParse(json)
      return { valid: true, subscriptionId: event.success ? (event.data.payload.subscription?.entity.id ?? null) : null }
    },
  }
}

export type RazorpayBilling = ReturnType<typeof razorpayBilling>
