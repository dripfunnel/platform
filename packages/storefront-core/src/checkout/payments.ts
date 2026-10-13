'use client'

import type { Stripe, StripeConstructorOptions } from '@stripe/stripe-js'
import { loadStripe } from '@stripe/stripe-js/pure'
import { setScriptSrc } from '../platform/csp/trustedTypes'
import type { Money } from '../pricing/money'

// The payment adapters (storefront ARCHITECTURE §2.1 `checkout`): each loads its own provider's SDK only when the shopper
// pays with it, from the host the store's CSP lists (§3.5), and takes the payment the Shop API's placeOrder started.

/** What placeOrder (or payOrder, after a decline) answers for a card provider (FIRST-RELEASE §19, #309). */
export type PaymentStart = { providerRef: string; publicKey: string | null; accountId: string | null; clientSecret: string | null; sessionId: string | null; redirectUrl: string | null }

/** How a payment ended in the browser; the order's own state is read back from the Shop API afterwards. */
export type PayOutcome = { kind: 'paid' } | { kind: 'away' } | { kind: 'cancelled' } | { kind: 'failed'; message: string | null }

export type PayContext = {
  orderId: string
  start: PaymentStart
  amount: Money
  /** The page a provider that takes the shopper away sends them back to: the order's own (`/order/{id}/`). */
  returnUrl: string
  /** The preview's test mode (PREVIEW §5 step 6). */
  test: boolean
  /** Express wallets (Apple Pay, Google Pay), only on a live shop (decided on #313: hidden on the preview domain). */
  wallets: boolean
  locale: string
  /** Inside the sealed payment element: where a provider draws its own field or buttons. */
  host: HTMLElement
  contact: { email: string | null; phone: string | null; name: string | null }
}

/**
 * A provider's window or field for a placed order: `submit` when the shopper presses core's Pay (it answers what to fix,
 * such as a card number, while the field stays open), else the provider's own. `outcome` settles once the payment ends.
 */
export type PaySession = { submit: (() => Promise<string | null>) | null; outcome: Promise<PayOutcome>; close: () => void }

export type PaymentAdapter = (ctx: PayContext, sdk: Sdk) => Promise<PaySession>

/** Loads a provider's script once, through Trusted Types (ARCHITECTURE §3.5); tests give their own. */
export type Sdk = { script: (url: string) => Promise<void>; stripe: (key: string, options: StripeConstructorOptions) => Promise<Stripe | null>; go: (url: string) => void }

const loaded = new Map<string, Promise<void>>()

export const browserSdk: Sdk = {
  script: (url) => {
    let found = loaded.get(url)
    if (!found) {
      found = new Promise<void>((resolve, reject) => {
        const s = document.createElement('script')
        s.async = true
        s.onload = () => resolve()
        s.onerror = () => {
          loaded.delete(url)
          reject(new Error('The payment provider could not be reached.'))
        }
        setScriptSrc(s, url)
        document.head.appendChild(s)
      })
      loaded.set(url, found)
    }
    return found
  },
  stripe: (key, options) => loadStripe(key, options),
  go: (url) => location.assign(url),
}

const settled = () => {
  let settle: (o: PayOutcome) => void = () => undefined
  const outcome = new Promise<PayOutcome>((resolve) => {
    settle = resolve
  })
  return { outcome, settle }
}

const minor = (m: Money) => Number(m.amount)

/** Stripe's Payment Element in the sealed element, wallets only on a live shop; core's Pay confirms it (#278's Stripe.js). */
const stripe: PaymentAdapter = async (ctx, sdk) => {
  const { start } = ctx
  if (!start.publicKey || !start.clientSecret) throw new Error('Stripe needs its key and the payment’s secret.')
  const client = await sdk.stripe(start.publicKey, start.accountId ? { stripeAccount: start.accountId, locale: 'auto' } : { locale: 'auto' })
  if (!client) throw new Error('Stripe.js could not load.')
  const elements = client.elements({ clientSecret: start.clientSecret })
  const element = elements.create('payment', { wallets: { applePay: ctx.wallets ? 'auto' : 'never', googlePay: ctx.wallets ? 'auto' : 'never' } })
  element.mount(ctx.host)
  const { outcome, settle } = settled()
  return {
    submit: async () => {
      try {
        const r = await client.confirmPayment({ elements, confirmParams: { return_url: ctx.returnUrl }, redirect: 'if_required' })
        // A field to correct keeps the element open; anything else ends this attempt.
        if (r.error?.type === 'validation_error') return r.error.message ?? null
        settle(r.error ? { kind: 'failed', message: r.error.message ?? null } : { kind: 'paid' })
      } catch {
        settle({ kind: 'failed', message: null })
      }
      return null
    },
    outcome,
    close: () => element.destroy(),
  }
}

type RazorpayWindow = { Razorpay?: new (options: Record<string, unknown>) => { open: () => void; close: () => void } }

/** Razorpay's own window, opened at once: UPI, cards and netbanking there. */
const razorpay: PaymentAdapter = async (ctx, sdk) => {
  if (!ctx.start.publicKey) throw new Error('Razorpay needs its key id.')
  await sdk.script('https://checkout.razorpay.com/v1/checkout.js')
  const Checkout = (globalThis as RazorpayWindow).Razorpay
  if (!Checkout) throw new Error('Razorpay could not load.')
  const { outcome, settle } = settled()
  const window = new Checkout({
    key: ctx.start.publicKey,
    order_id: ctx.start.providerRef,
    amount: minor(ctx.amount),
    currency: ctx.amount.currency,
    prefill: { email: ctx.contact.email ?? undefined, contact: ctx.contact.phone ?? undefined, name: ctx.contact.name ?? undefined },
    handler: () => settle({ kind: 'paid' }),
    modal: { ondismiss: () => settle({ kind: 'cancelled' }) },
  })
  window.open()
  return { submit: null, outcome, close: () => window.close() }
}

type CashfreeWindow = { Cashfree?: (o: { mode: 'sandbox' | 'production' }) => { checkout: (o: { paymentSessionId: string; redirectTarget: '_self' }) => Promise<unknown> } }

/** Cashfree's checkout takes the shopper to its page and back to the order's (FIRST-RELEASE §19 Part 3). */
const cashfree: PaymentAdapter = async (ctx, sdk) => {
  if (!ctx.start.sessionId) throw new Error('Cashfree needs its session.')
  await sdk.script('https://sdk.cashfree.com/js/v3/cashfree.js')
  const make = (globalThis as CashfreeWindow).Cashfree
  if (!make) throw new Error('Cashfree could not load.')
  // Cashfree takes the shopper away; its promise answers only when it couldn't.
  const outcome = make({ mode: ctx.test ? 'sandbox' : 'production' })
    .checkout({ paymentSessionId: ctx.start.sessionId, redirectTarget: '_self' })
    .then(
      (r): PayOutcome => (r && typeof r === 'object' && 'error' in r ? { kind: 'failed', message: null } : { kind: 'away' }),
      (): PayOutcome => ({ kind: 'failed', message: null }),
    )
  return { submit: null, outcome, close: () => undefined }
}

/** PhonePe opens its app from its own page, which sends the shopper back to the order's. */
const phonepe: PaymentAdapter = async (ctx, sdk) => {
  if (!ctx.start.redirectUrl) throw new Error('PhonePe needs its page.')
  try {
    sdk.go(ctx.start.redirectUrl)
  } catch {
    return { submit: null, outcome: Promise.resolve({ kind: 'failed', message: null }), close: () => undefined }
  }
  return { submit: null, outcome: Promise.resolve({ kind: 'away' }), close: () => undefined }
}

type PayPalWindow = { paypal?: { Buttons: (o: Record<string, unknown>) => { render: (host: HTMLElement) => Promise<void>; close: () => Promise<void> } } }

/** PayPal's own buttons in the sealed element, approving the order placeOrder made there. */
const paypal: PaymentAdapter = async (ctx, sdk) => {
  if (!ctx.start.publicKey) throw new Error('PayPal needs its client id.')
  const query = new URLSearchParams({ 'client-id': ctx.start.publicKey, currency: ctx.amount.currency, intent: 'capture', components: 'buttons' })
  await sdk.script(`https://www.paypal.com/sdk/js?${query.toString()}`)
  const pp = (globalThis as PayPalWindow).paypal
  if (!pp) throw new Error('PayPal could not load.')
  const { outcome, settle } = settled()
  const buttons = pp.Buttons({
    createOrder: () => ctx.start.providerRef,
    onApprove: () => settle({ kind: 'paid' }),
    onCancel: () => settle({ kind: 'cancelled' }),
    onError: () => settle({ kind: 'failed', message: null }),
  })
  await buttons.render(ctx.host)
  return { submit: null, outcome, close: () => void buttons.close() }
}

/** Each card provider placeOrder can start; cash on delivery, a bank transfer and a gift card need none. */
export const paymentAdapters: Readonly<Record<string, PaymentAdapter>> = { stripe, razorpay, cashfree, phonepe, paypal }
