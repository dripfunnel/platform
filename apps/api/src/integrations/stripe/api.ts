import { z } from 'zod'

// DripFunnel's platform Stripe account (THIRD-PARTY-ACCESS §2.7) over its REST API, with the
// restricted key. Only what the Platform API reads or writes; card and bank numbers never pass
// through: the browser turns them into tokens with Stripe's own fields.

const apiBase = 'https://api.stripe.com/v1'
export const stripeTimeoutMs = 10_000

/** Stripe didn't answer in time or failed itself; the caller says so and keeps what it has (SAAS §7.2). */
export class StripeUnavailable extends Error {
  override name = 'StripeUnavailable'
}

/** Stripe refused the request: a bad or used token, or a declined card. `code` is Stripe's. */
export class StripeRefused extends Error {
  override name = 'StripeRefused'
  constructor(readonly code: string) {
    super(`stripe refused: ${code}`)
  }
}

const metadata = z.record(z.string(), z.string()).nullish().transform((m) => m ?? {})
const id = (prefixes: string) => z.string().regex(new RegExp(`^(?:${prefixes})_[A-Za-z0-9]+$`))

export const eventSchema = z.object({
  id: id('evt'),
  type: z.string().max(100),
  account: id('acct').nullish(),
  // `customer` only to say whose feed is stale when Stripe can't be read back; never to write.
  data: z.object({ object: z.object({ id: z.string().max(255), object: z.string(), customer: z.string().max(255).nullish() }).loose() }),
})
export type StripeEvent = z.infer<typeof eventSchema>

const transferSchema = z.object({ amount: z.number().int().nonnegative(), currency: z.string() }).nullish()

const chargeSchema = z.object({
  id: id('ch|py'),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  failure_message: z.string().nullish(),
  payment_method_details: z.object({ card: z.object({ last4: z.string() }).nullish() }).nullish(),
  transfer: transferSchema.or(z.string()).nullish(),
  refunds: z.object({ data: z.array(z.object({ id: id('re'), amount: z.number().int().nonnegative(), status: z.string(), created: z.number().int() })) }).nullish(),
  invoice: z.string().nullish(),
})
export type StripeCharge = z.infer<typeof chargeSchema>

export const invoiceSchema = z.object({
  id: id('in'),
  number: z.string().nullish(),
  customer: z.string(),
  status: z.enum(['draft', 'open', 'paid', 'uncollectible', 'void']),
  billing_reason: z.string().nullish(),
  description: z.string().nullish(),
  amount_due: z.number().int().nonnegative(),
  amount_paid: z.number().int().nonnegative(),
  currency: z.string(),
  attempt_count: z.number().int().nonnegative(),
  next_payment_attempt: z.number().int().nullish(),
  application_fee_amount: z.number().int().nonnegative().nullish(),
  created: z.number().int(),
  due_date: z.number().int().nullish(),
  status_transitions: z.object({ paid_at: z.number().int().nullish(), finalized_at: z.number().int().nullish() }).nullish(),
  invoice_pdf: z.string().nullish(),
  metadata,
  subscription_details: z.object({ metadata }).nullish(),
  lines: z.object({ data: z.array(z.object({ description: z.string().nullish() })) }).nullish(),
  charge: chargeSchema.or(z.string()).nullish(),
})
export type StripeInvoice = z.infer<typeof invoiceSchema>

const payoutSchema = z.object({
  id: id('po'),
  amount: z.number().int().nonnegative(),
  currency: z.string(),
  arrival_date: z.number().int(),
  status: z.enum(['paid', 'pending', 'in_transit', 'canceled', 'failed']),
  failure_message: z.string().nullish(),
  destination: z.object({ last4: z.string() }).loose().or(z.string()).nullish(),
})
export type StripePayout = z.infer<typeof payoutSchema>

const bankAccountSchema = z.object({
  id: z.string(),
  bank_name: z.string().nullish(),
  last4: z.string().regex(/^[0-9]{4}$/),
  status: z.enum(['new', 'validated', 'verified', 'verification_failed', 'errored']),
})
export type StripeBankAccount = z.infer<typeof bankAccountSchema>

const accountSchema = z.object({ id: id('acct'), external_accounts: z.object({ data: z.array(bankAccountSchema.loose()) }).nullish() })
export type StripeAccount = z.infer<typeof accountSchema>

const cardSchema = z.object({ id: id('pm'), card: z.object({ brand: z.string(), last4: z.string().regex(/^[0-9]{4}$/), exp_month: z.number().int(), exp_year: z.number().int() }) })
export type StripeCard = z.infer<typeof cardSchema>

const errorSchema = z.object({ error: z.object({ code: z.string().nullish(), type: z.string().nullish() }) })

/** Stripe's form encoding, nested keys as `a[b]`. */
const form = (params: Record<string, string | Record<string, string> | undefined>): string => {
  const body = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue
    if (typeof v === 'string') body.set(k, v)
    else for (const [k2, v2] of Object.entries(v)) body.set(`${k}[${k2}]`, v2)
  }
  return body.toString()
}

export interface StripeApi {
  createAccount: (input: { partnerId: string; country: string; email: string | null }) => Promise<{ id: string }>
  addBankAccount: (accountId: string, token: string) => Promise<StripeBankAccount>
  createCustomer: (input: { partnerId: string; name: string }) => Promise<{ id: string }>
  attachCard: (customerId: string, paymentMethodId: string) => Promise<StripeCard>
  charge: (chargeId: string) => Promise<StripeCharge>
  invoice: (invoiceId: string) => Promise<StripeInvoice>
  payout: (accountId: string, payoutId: string) => Promise<StripePayout>
  account: (accountId: string) => Promise<StripeAccount>
}

export const stripeClient = ({ secretKey, fetchImpl = fetch }: { secretKey: string; fetchImpl?: typeof fetch }): StripeApi => {
  const call = async <S extends z.ZodType>(schema: S, method: 'GET' | 'POST', path: string, opts: { body?: string; account?: string; idempotencyKey?: string } = {}): Promise<z.infer<S>> => {
    let response: Response
    try {
      response = await fetchImpl(`${apiBase}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${secretKey}`,
          'content-type': 'application/x-www-form-urlencoded',
          ...(opts.account ? { 'stripe-account': opts.account } : {}),
          ...(opts.idempotencyKey ? { 'idempotency-key': opts.idempotencyKey } : {}),
        },
        body: opts.body ?? null,
        signal: AbortSignal.timeout(stripeTimeoutMs),
      })
    } catch {
      throw new StripeUnavailable('no answer')
    }
    if (response.status >= 500 || response.status === 429) throw new StripeUnavailable(`answered ${response.status}`)
    const json: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const parsed = errorSchema.safeParse(json)
      throw new StripeRefused(parsed.success ? (parsed.data.error.code ?? parsed.data.error.type ?? 'refused') : 'refused')
    }
    const parsed = schema.safeParse(json)
    if (!parsed.success) throw new StripeUnavailable('answered in a shape we do not read')
    return parsed.data
  }

  return {
    // Custom accounts: the partner gives its bank account in the console, not on a Stripe page.
    createAccount: ({ partnerId, country, email }) =>
      call(z.object({ id: id('acct') }), 'POST', '/accounts', {
        body: form({ type: 'custom', country, email: email ?? undefined, 'capabilities[transfers][requested]': 'true', metadata: { partner_id: partnerId } }),
        idempotencyKey: `connect-account:${partnerId}`,
      }),
    addBankAccount: (accountId, token) =>
      call(bankAccountSchema.loose(), 'POST', `/accounts/${encodeURIComponent(accountId)}/external_accounts`, { body: form({ external_account: token, default_for_currency: 'true' }) }),
    createCustomer: ({ partnerId, name }) =>
      call(z.object({ id: id('cus') }), 'POST', '/customers', { body: form({ name, metadata: { partner_id: partnerId, audience: 'partner' } }), idempotencyKey: `partner-customer:${partnerId}` }),
    attachCard: async (customerId, paymentMethodId) => {
      const card = await call(cardSchema.loose(), 'POST', `/payment_methods/${encodeURIComponent(paymentMethodId)}/attach`, { body: form({ customer: customerId }) })
      await call(z.object({ id: id('cus') }).loose(), 'POST', `/customers/${encodeURIComponent(customerId)}`, { body: form({ 'invoice_settings[default_payment_method]': paymentMethodId }) })
      return card
    },
    charge: (chargeId) => call(chargeSchema.loose(), 'GET', `/charges/${encodeURIComponent(chargeId)}?expand[]=transfer&expand[]=refunds`),
    invoice: (invoiceId) => call(invoiceSchema.loose(), 'GET', `/invoices/${encodeURIComponent(invoiceId)}?expand[]=charge&expand[]=charge.transfer`),
    payout: (accountId, payoutId) => call(payoutSchema.loose(), 'GET', `/payouts/${encodeURIComponent(payoutId)}?expand[]=destination`, { account: accountId }),
    account: (accountId) => call(accountSchema.loose(), 'GET', `/accounts/${encodeURIComponent(accountId)}`),
  }
}
