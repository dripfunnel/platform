import { z } from 'zod'
import { form, stripeId, stripeRequester, StripeRefused, StripeUnavailable, subscriptionSchema, invoiceSchema, type StripeCard, type StripeInvoice, type StripeSubscription } from './api'

// A store's plan on DripFunnel's platform account (SAAS §7.2): its customer, its subscription and a change scheduled
// for the period's end. Each write that charges carries the caller's idempotency key, so a retry or a second tab
// gets Stripe's first answer back instead of a second charge.

export interface SubscriptionPrice {
  /** Stripe's product for the plan (`ensurePlanProduct`). */
  product: string
  currency: string
  /** Minor units for one period. */
  amount: number
  interval: 'month' | 'year'
}

export interface StoreBillingStripe {
  createStoreCustomer: (input: { storeId: string; partnerId: string; name: string; email: string | null }) => Promise<{ id: string }>
  updateCustomer: (customerId: string, details: { name: string; email: string; address: Record<string, string> }) => Promise<void>
  ensurePlanProduct: (plan: { id: string; name: string }) => Promise<string>
  /** Charges the first period now; a declined card refuses it (`StripeRefused`) and nothing is subscribed. */
  createSubscription: (input: { customer: string; price: SubscriptionPrice; metadata: Record<string, string> }, idempotencyKey: string) => Promise<StripeSubscription>
  /** Moves now and invoices the proration at once; a declined card refuses it and the subscription stays as it was. */
  changeSubscription: (subscription: StripeSubscription, input: { price: SubscriptionPrice; metadata: Record<string, string> }, idempotencyKey: string) => Promise<StripeSubscription>
  /** The change at the current period's end, through a subscription schedule; answers the schedule's id. */
  scheduleChange: (subscription: StripeSubscription, input: { price: SubscriptionPrice; metadata: Record<string, string> }, idempotencyKey: string) => Promise<string>
  releaseSchedule: (scheduleId: string) => Promise<void>
  /** Ends the subscription at its period's end; nothing more is charged. */
  cancelAtPeriodEnd: (subscriptionId: string, idempotencyKey: string) => Promise<StripeSubscription>
  /** Ends it now, no refund (#1056); one already ended or gone is left as it is, and any other refusal is thrown. */
  cancelNow: (subscriptionId: string) => Promise<void>
  /** Tries the open invoice again with the customer's card; the key is per card, so a new card tries once more. */
  payInvoice: (invoiceId: string, idempotencyKey: string) => Promise<StripeInvoice>
  /** Stripe's own page to save a card (Checkout, `setup` mode): the number is typed, and 3D Secure asked, on Stripe's side. */
  createCardSetup: (input: { customer: string; successUrl: string; cancelUrl: string; metadata: Record<string, string> }) => Promise<{ id: string; url: string }>
  /** What that page saved, read back by its id and made the customer's default card; null while it isn't finished. */
  finishCardSetup: (sessionId: string) => Promise<{ customer: string; card: StripeCard } | null>
}

const sessionId = z.string().regex(/^cs_(?:test|live)_[A-Za-z0-9]+$/)
const setupCreated = z.object({ id: sessionId, url: z.string().url() })
const setupRead = z.object({
  customer: z.string().nullable(),
  status: z.string(),
  setup_intent: z
    .object({
      status: z.string(),
      payment_method: z.object({ id: stripeId('pm'), card: z.object({ brand: z.string(), last4: z.string().regex(/^[0-9]{4}$/), exp_month: z.number().int(), exp_year: z.number().int() }) }).nullable(),
    })
    .nullable(),
})

const scheduleSchema = z.object({
  id: stripeId('sub_sched'),
  phases: z.array(z.object({ start_date: z.number().int(), end_date: z.number().int().nullish() }).loose()),
})

const priceParams = (prefix: string, p: SubscriptionPrice): Record<string, string> => ({
  [`${prefix}[price_data][product]`]: p.product,
  [`${prefix}[price_data][currency]`]: p.currency.toLowerCase(),
  [`${prefix}[price_data][unit_amount]`]: String(p.amount),
  [`${prefix}[price_data][recurring][interval]`]: p.interval,
  [`${prefix}[quantity]`]: '1',
})

// Stripe's own ids are letters and digits; a product id is ours, made from the plan's.
const productIdOf = (planId: string) => `dfplan_${planId.replaceAll('-', '')}`

export const storeBillingStripe = ({ secretKey, fetchImpl = fetch }: { secretKey: string; fetchImpl?: typeof fetch }): StoreBillingStripe => {
  const call = stripeRequester({ secretKey, fetchImpl })
  const subscription = subscriptionSchema.loose()
  const itemOf = (s: StripeSubscription) => {
    const item = s.items.data[0]
    if (!item) throw new StripeUnavailable('a subscription with no item')
    return item
  }

  return {
    createStoreCustomer: ({ storeId, partnerId, name, email }) =>
      call(z.object({ id: stripeId('cus') }), 'POST', '/customers', {
        body: form({ name, email: email ?? undefined, metadata: { store_id: storeId, partner_id: partnerId, audience: 'store' } }),
        idempotencyKey: `store-customer:${storeId}`,
      }),
    updateCustomer: async (customerId, { name, email, address }) => {
      await call(z.object({ id: stripeId('cus') }).loose(), 'POST', `/customers/${encodeURIComponent(customerId)}`, { body: form({ name, email, address }) })
    },
    ensurePlanProduct: async ({ id, name }) => {
      const productId = productIdOf(id)
      try {
        await call(z.object({ id: z.string() }).loose(), 'POST', '/products', { body: form({ id: productId, name }) })
      } catch (error) {
        if (!(error instanceof StripeRefused && error.code === 'resource_already_exists')) throw error
      }
      return productId
    },
    createSubscription: ({ customer, price, metadata }, idempotencyKey) =>
      call(subscription, 'POST', '/subscriptions', {
        body: form({ customer, ...priceParams('items[0]', price), payment_behavior: 'error_if_incomplete', metadata }),
        idempotencyKey,
      }),
    changeSubscription: (current, { price, metadata }, idempotencyKey) =>
      call(subscription, 'POST', `/subscriptions/${encodeURIComponent(current.id)}`, {
        body: form({
          'items[0][id]': itemOf(current).id,
          ...priceParams('items[0]', price),
          proration_behavior: 'always_invoice',
          payment_behavior: 'error_if_incomplete',
          metadata,
        }),
        idempotencyKey,
      }),
    scheduleChange: async (current, { price, metadata }, idempotencyKey) => {
      const item = itemOf(current)
      const created = await call(scheduleSchema.loose(), 'POST', '/subscription_schedules', { body: form({ from_subscription: current.id }), idempotencyKey: `${idempotencyKey}:from` })
      const phase = created.phases[0]
      if (!phase?.end_date) throw new StripeUnavailable('a schedule with no current phase')
      await call(scheduleSchema.loose(), 'POST', `/subscription_schedules/${encodeURIComponent(created.id)}`, {
        body: form({
          end_behavior: 'release',
          'phases[0][items][0][price]': item.price.id,
          'phases[0][items][0][quantity]': '1',
          'phases[0][start_date]': String(phase.start_date),
          'phases[0][end_date]': String(phase.end_date),
          'phases[0][proration_behavior]': 'none',
          ...priceParams('phases[1][items][0]', price),
          'phases[1][iterations]': '1',
          'phases[1][proration_behavior]': 'none',
          'phases[1][metadata]': metadata,
        }),
        idempotencyKey,
      })
      return created.id
    },
    releaseSchedule: async (scheduleId) => {
      try {
        await call(z.object({ id: z.string() }).loose(), 'POST', `/subscription_schedules/${encodeURIComponent(scheduleId)}/release`)
      } catch (error) {
        // Released already, or ended: nothing scheduled is left, which is what was asked.
        if (!(error instanceof StripeRefused)) throw error
      }
    },
    cancelAtPeriodEnd: (subscriptionId, idempotencyKey) =>
      call(subscription, 'POST', `/subscriptions/${encodeURIComponent(subscriptionId)}`, { body: form({ cancel_at_period_end: 'true' }), idempotencyKey }),
    cancelNow: async (subscriptionId) => {
      const path = `/subscriptions/${encodeURIComponent(subscriptionId)}`
      try {
        // A DELETE is idempotent at Stripe, so it takes no key.
        await call(z.object({ id: z.string() }).loose(), 'DELETE', path)
      } catch (error) {
        if (!(error instanceof StripeRefused)) throw error
        if (error.code === 'resource_missing') return
        // Any other refusal (a revoked key, say) counts as done only if Stripe shows it ended.
        const current = await call(z.object({ status: subscriptionSchema.shape.status }).loose(), 'GET', path)
        if (current.status !== 'canceled') throw error
      }
    },
    payInvoice: (invoiceId, idempotencyKey) => call(invoiceSchema.loose(), 'POST', `/invoices/${encodeURIComponent(invoiceId)}/pay`, { idempotencyKey }),
    createCardSetup: ({ customer, successUrl, cancelUrl, metadata }) =>
      call(setupCreated.loose(), 'POST', '/checkout/sessions', {
        body: form({ mode: 'setup', customer, 'payment_method_types[0]': 'card', success_url: successUrl, cancel_url: cancelUrl, metadata }),
      }),
    finishCardSetup: async (id) => {
      const read = await call(setupRead.loose(), 'GET', `/checkout/sessions/${encodeURIComponent(id)}?expand[]=setup_intent.payment_method`)
      const method = read.setup_intent?.payment_method
      if (read.status !== 'complete' || read.setup_intent?.status !== 'succeeded' || !read.customer || !method) return null
      await call(z.object({ id: stripeId('cus') }).loose(), 'POST', `/customers/${encodeURIComponent(read.customer)}`, { body: form({ 'invoice_settings[default_payment_method]': method.id }) })
      return { customer: read.customer, card: method }
    },
  }
}
